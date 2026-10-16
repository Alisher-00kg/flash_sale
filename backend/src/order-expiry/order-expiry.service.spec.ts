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
    order: { findUnique: jest.Mock; updateMany: jest.Mock };
    flashSale: { findUnique: jest.Mock; update: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let websocketGateway: { emitStockUpdated: jest.Mock };

  const expiredOrder = (
    items: Array<{ flashSaleId: string; quantity: number }> = [],
  ) => ({
    id: 'order-1',
    status: 'PENDING_PAYMENT',
    reservedUntil: new Date(Date.now() - 60_000),
    items,
  });

  const activeSale = (id = 'sale-1') => ({
    id,
    availableQuantity: 7,
    soldQuantity: 3,
    finishedAt: null,
    endsAt: new Date(Date.now() + 60_000),
  });

  beforeEach(async () => {
    tx = {
      order: {
        findUnique: jest.fn(),
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
      select: { id: true },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(websocketGateway.emitStockUpdated).not.toHaveBeenCalled();
  });

  it('should not expire orders whose payment is processing', async () => {
    prisma.order.findMany.mockResolvedValue([
      { id: 'order-1' },
    ]);
    tx.order.findUnique.mockResolvedValue({
      ...expiredOrder(),
      status: 'PAYMENT_PROCESSING',
    });

    await service.handleExpiredOrders();

    expect(tx.order.updateMany).not.toHaveBeenCalled();
    expect(tx.flashSale.update).not.toHaveBeenCalled();
    expect(websocketGateway.emitStockUpdated).not.toHaveBeenCalled();
  });

  it('should expire an order, restore stock and emit a stock update', async () => {
    prisma.order.findMany.mockResolvedValue([{ id: 'order-1' }]);
    tx.order.findUnique.mockResolvedValue(
      expiredOrder([{ flashSaleId: 'sale-1', quantity: 2 }]),
    );
    tx.order.updateMany.mockResolvedValue({ count: 1 });
    tx.flashSale.findUnique.mockResolvedValue(activeSale());
    tx.flashSale.update.mockResolvedValue({
      id: 'sale-1',
      availableQuantity: 9,
      soldQuantity: 3,
    });

    await service.handleExpiredOrders();

    expect(tx.order.findUnique).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      include: { items: true },
    });
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'order-1',
        status: 'PENDING_PAYMENT',
        reservedUntil: { lte: expect.any(Date) },
      },
      data: { status: 'EXPIRED' },
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
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

  it('should skip restoration if the order is no longer pending payment', async () => {
    prisma.order.findMany.mockResolvedValue([{ id: 'order-1' }]);
    tx.order.findUnique.mockResolvedValue({
      ...expiredOrder([{ flashSaleId: 'sale-1', quantity: 2 }]),
      status: 'PAID',
    });

    await service.handleExpiredOrders();

    expect(tx.order.updateMany).not.toHaveBeenCalled();
    expect(tx.flashSale.update).not.toHaveBeenCalled();
    expect(websocketGateway.emitStockUpdated).not.toHaveBeenCalled();
  });

  it('should skip stock restoration if another process claimed the order', async () => {
    prisma.order.findMany.mockResolvedValue([{ id: 'order-1' }]);
    tx.order.findUnique.mockResolvedValue(
      expiredOrder([{ flashSaleId: 'sale-1', quantity: 2 }]),
    );
    tx.order.updateMany.mockResolvedValue({ count: 0 });

    await service.handleExpiredOrders();

    expect(tx.flashSale.findUnique).not.toHaveBeenCalled();
    expect(tx.flashSale.update).not.toHaveBeenCalled();
    expect(websocketGateway.emitStockUpdated).not.toHaveBeenCalled();
  });

  it('should skip an order whose reservation has not expired', async () => {
    prisma.order.findMany.mockResolvedValue([{ id: 'order-1' }]);
    tx.order.findUnique.mockResolvedValue({
      ...expiredOrder([{ flashSaleId: 'sale-1', quantity: 2 }]),
      reservedUntil: new Date(Date.now() + 60_000),
    });

    await service.handleExpiredOrders();

    expect(tx.order.updateMany).not.toHaveBeenCalled();
    expect(tx.flashSale.update).not.toHaveBeenCalled();
  });

  it('should skip a flash sale that no longer exists', async () => {
    prisma.order.findMany.mockResolvedValue([{ id: 'order-1' }]);
    tx.order.findUnique.mockResolvedValue(
      expiredOrder([{ flashSaleId: 'sale-1', quantity: 2 }]),
    );
    tx.order.updateMany.mockResolvedValue({ count: 1 });
    tx.flashSale.findUnique.mockResolvedValue(null);

    await service.handleExpiredOrders();

    expect(tx.flashSale.update).not.toHaveBeenCalled();
    expect(websocketGateway.emitStockUpdated).not.toHaveBeenCalled();
  });

  it('should skip a finished flash sale', async () => {
    prisma.order.findMany.mockResolvedValue([{ id: 'order-1' }]);
    tx.order.findUnique.mockResolvedValue(
      expiredOrder([{ flashSaleId: 'sale-1', quantity: 2 }]),
    );
    tx.order.updateMany.mockResolvedValue({ count: 1 });
    tx.flashSale.findUnique.mockResolvedValue({
      ...activeSale(),
      finishedAt: new Date(),
    });

    await service.handleExpiredOrders();

    expect(tx.flashSale.update).not.toHaveBeenCalled();
    expect(websocketGateway.emitStockUpdated).not.toHaveBeenCalled();
  });

  it('should skip a flash sale whose end time has passed', async () => {
    prisma.order.findMany.mockResolvedValue([{ id: 'order-1' }]);
    tx.order.findUnique.mockResolvedValue(
      expiredOrder([{ flashSaleId: 'sale-1', quantity: 2 }]),
    );
    tx.order.updateMany.mockResolvedValue({ count: 1 });
    tx.flashSale.findUnique.mockResolvedValue({
      ...activeSale(),
      endsAt: new Date(Date.now() - 60_000),
    });

    await service.handleExpiredOrders();

    expect(tx.flashSale.update).not.toHaveBeenCalled();
    expect(websocketGateway.emitStockUpdated).not.toHaveBeenCalled();
  });

  it('should restore stock only for eligible items', async () => {
    prisma.order.findMany.mockResolvedValue([{ id: 'order-1' }]);
    tx.order.findUnique.mockResolvedValue(
      expiredOrder([
        { flashSaleId: 'sale-active', quantity: 2 },
        { flashSaleId: 'sale-missing', quantity: 1 },
        { flashSaleId: 'sale-finished', quantity: 4 },
      ]),
    );
    tx.order.updateMany.mockResolvedValue({ count: 1 });
    tx.flashSale.findUnique
      .mockResolvedValueOnce(activeSale('sale-active'))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...activeSale('sale-finished'),
        finishedAt: new Date(),
      });
    tx.flashSale.update.mockResolvedValue({
      id: 'sale-active',
      availableQuantity: 9,
      soldQuantity: 3,
    });

    await service.handleExpiredOrders();

    // One lock for the order and one per distinct flash sale.
    expect(tx.$queryRaw).toHaveBeenCalledTimes(4);
    expect(tx.flashSale.findUnique).toHaveBeenCalledTimes(3);
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
      { id: 'order-1' },
      { id: 'order-2' },
    ]);
    tx.order.findUnique
      .mockResolvedValueOnce(expiredOrder([]))
      .mockResolvedValueOnce({
        ...expiredOrder([]),
        id: 'order-2',
      });
    tx.order.updateMany.mockResolvedValue({ count: 1 });

    await service.handleExpiredOrders();

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.order.updateMany).toHaveBeenCalledTimes(2);
  });
});
