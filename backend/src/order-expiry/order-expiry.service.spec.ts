import { Test, TestingModule } from '@nestjs/testing';
import { OrderExpiryService } from './order-expiry.service';
import { PrismaService } from '../prisma/prisma.service';
import { WebsocketGateway } from '../websocket/websocket.gateway';

describe('OrderExpiryService', () => {
  let service: OrderExpiryService;
  let prisma: {
    order: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let tx: {
    order: { updateMany: jest.Mock };
    flashSale: { findUnique: jest.Mock; update: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let websocketGateway: { emitStockUpdated: jest.Mock };

  beforeEach(async () => {
    tx = {
      order: {
        updateMany: jest.fn(),
      },
      flashSale: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $queryRaw: jest.fn(),
    };

    prisma = {
      order: {
        findMany: jest.fn(),
      },
      $transaction: jest.fn((callback) => callback(tx)),
    };

    websocketGateway = {
      emitStockUpdated: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderExpiryService,
        { provide: PrismaService, useValue: prisma },
        { provide: WebsocketGateway, useValue: websocketGateway },
      ],
    }).compile();

    service = module.get<OrderExpiryService>(OrderExpiryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should do nothing when there are no expired orders', async () => {
    prisma.order.findMany.mockResolvedValue([]);

    await service.handleExpiredOrders();

    expect(prisma.order.findMany).toHaveBeenCalledWith({
      where: {
        status: 'PENDING_PAYMENT',
        reservedUntil: { lte: expect.any(Date) },
      },
      include: { items: true },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(websocketGateway.emitStockUpdated).not.toHaveBeenCalled();
  });

  it('should expire an order, restore stock and emit a stock update', async () => {
    const order = {
      id: 'order-1',
      items: [{ flashSaleId: 'sale-1', quantity: 2 }],
    };
    const flashSale = {
      id: 'sale-1',
      availableQuantity: 7,
      soldQuantity: 3,
      finishedAt: null,
      endsAt: new Date(Date.now() + 60_000),
    };

    prisma.order.findMany.mockResolvedValue([order]);
    tx.order.updateMany.mockResolvedValue({ count: 1 });
    tx.flashSale.findUnique.mockResolvedValue(flashSale);
    tx.flashSale.update.mockResolvedValue({
      id: 'sale-1',
      availableQuantity: 9,
      soldQuantity: 3,
    });

    await service.handleExpiredOrders();

    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'order-1',
        status: 'PENDING_PAYMENT',
        reservedUntil: { lte: expect.any(Date) },
      },
      data: { status: 'EXPIRED' },
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.flashSale.update).toHaveBeenCalledWith({
      where: { id: 'sale-1' },
      data: { availableQuantity: { increment: 2 } },
    });
    expect(websocketGateway.emitStockUpdated).toHaveBeenCalledWith(
      'sale-1',
      9,
      3,
    );
  });

  it('should skip stock restoration if the order was updated by another process', async () => {
    prisma.order.findMany.mockResolvedValue([
      { id: 'order-1', items: [{ flashSaleId: 'sale-1', quantity: 2 }] },
    ]);
    tx.order.updateMany.mockResolvedValue({ count: 0 });

    await service.handleExpiredOrders();

    expect(tx.flashSale.findUnique).not.toHaveBeenCalled();
    expect(tx.flashSale.update).not.toHaveBeenCalled();
    expect(websocketGateway.emitStockUpdated).not.toHaveBeenCalled();
  });

  it('should skip a flash sale that no longer exists', async () => {
    prisma.order.findMany.mockResolvedValue([
      { id: 'order-1', items: [{ flashSaleId: 'sale-1', quantity: 2 }] },
    ]);
    tx.order.updateMany.mockResolvedValue({ count: 1 });
    tx.flashSale.findUnique.mockResolvedValue(null);

    await service.handleExpiredOrders();

    expect(tx.flashSale.update).not.toHaveBeenCalled();
    expect(websocketGateway.emitStockUpdated).not.toHaveBeenCalled();
  });

  it('should skip a finished flash sale', async () => {
    prisma.order.findMany.mockResolvedValue([
      { id: 'order-1', items: [{ flashSaleId: 'sale-1', quantity: 2 }] },
    ]);
    tx.order.updateMany.mockResolvedValue({ count: 1 });
    tx.flashSale.findUnique.mockResolvedValue({
      id: 'sale-1',
      availableQuantity: 7,
      soldQuantity: 3,
      finishedAt: new Date(),
      endsAt: new Date(Date.now() + 60_000),
    });

    await service.handleExpiredOrders();

    expect(tx.flashSale.update).not.toHaveBeenCalled();
    expect(websocketGateway.emitStockUpdated).not.toHaveBeenCalled();
  });

  it('should skip a flash sale whose end time has passed', async () => {
    prisma.order.findMany.mockResolvedValue([
      { id: 'order-1', items: [{ flashSaleId: 'sale-1', quantity: 2 }] },
    ]);
    tx.order.updateMany.mockResolvedValue({ count: 1 });
    tx.flashSale.findUnique.mockResolvedValue({
      id: 'sale-1',
      availableQuantity: 7,
      soldQuantity: 3,
      finishedAt: null,
      endsAt: new Date(Date.now() - 60_000),
    });

    await service.handleExpiredOrders();

    expect(tx.flashSale.update).not.toHaveBeenCalled();
    expect(websocketGateway.emitStockUpdated).not.toHaveBeenCalled();
  });

  it('should restore stock for eligible items and skip ineligible items', async () => {
    prisma.order.findMany.mockResolvedValue([
      {
        id: 'order-1',
        items: [
          { flashSaleId: 'sale-active', quantity: 2 },
          { flashSaleId: 'sale-missing', quantity: 1 },
          { flashSaleId: 'sale-finished', quantity: 4 },
        ],
      },
    ]);
    tx.order.updateMany.mockResolvedValue({ count: 1 });
    tx.flashSale.findUnique
      .mockResolvedValueOnce({
        id: 'sale-active',
        availableQuantity: 7,
        soldQuantity: 3,
        finishedAt: null,
        endsAt: new Date(Date.now() + 60_000),
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'sale-finished',
        availableQuantity: 5,
        soldQuantity: 8,
        finishedAt: new Date(),
        endsAt: new Date(Date.now() + 60_000),
      });
    tx.flashSale.update.mockResolvedValue({
      id: 'sale-active',
      availableQuantity: 9,
      soldQuantity: 3,
    });

    await service.handleExpiredOrders();

    expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
    expect(tx.flashSale.update).toHaveBeenCalledTimes(1);
    expect(websocketGateway.emitStockUpdated).toHaveBeenCalledTimes(1);
    expect(websocketGateway.emitStockUpdated).toHaveBeenCalledWith(
      'sale-active',
      9,
      3,
    );
  });

  it('should process multiple expired orders', async () => {
    prisma.order.findMany.mockResolvedValue([
      { id: 'order-1', items: [] },
      { id: 'order-2', items: [] },
    ]);
    tx.order.updateMany.mockResolvedValue({ count: 1 });

    await service.handleExpiredOrders();

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.order.updateMany).toHaveBeenCalledTimes(2);
  });
});
