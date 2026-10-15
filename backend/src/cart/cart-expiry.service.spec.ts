import { Test, TestingModule } from '@nestjs/testing';
import { CartExpiryService } from './cart-expiry.service';
import { PrismaService } from '../prisma/prisma.service';
import { WebsocketGateway } from '../websocket/websocket.gateway';

describe('CartExpiryService', () => {
  let service: CartExpiryService;
  let prisma: {
    cart: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let tx: {
    cart: { updateMany: jest.Mock };
    flashSale: { findUnique: jest.Mock; update: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let websocketGateway: { emitStockUpdated: jest.Mock };

  beforeEach(async () => {
    tx = {
      cart: {
        updateMany: jest.fn(),
      },
      flashSale: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $queryRaw: jest.fn(),
    };

    prisma = {
      cart: {
        findMany: jest.fn(),
      },
      $transaction: jest.fn((callback) => callback(tx)),
    };

    websocketGateway = {
      emitStockUpdated: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CartExpiryService,
        { provide: PrismaService, useValue: prisma },
        { provide: WebsocketGateway, useValue: websocketGateway },
      ],
    }).compile();

    service = module.get<CartExpiryService>(CartExpiryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should do nothing when there are no expired carts', async () => {
    prisma.cart.findMany.mockResolvedValue([]);

    await service.handleExpiredCarts();

    expect(prisma.cart.findMany).toHaveBeenCalledWith({
      where: {
        status: 'ACTIVE',
        expiresAt: { lte: expect.any(Date) },
      },
      include: { items: true },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(websocketGateway.emitStockUpdated).not.toHaveBeenCalled();
  });

  it('should expire a cart and restore stock for an active flash sale', async () => {
    prisma.cart.findMany.mockResolvedValue([
      {
        id: 'cart-1',
        items: [{ flashSaleId: 'sale-1', quantity: 2 }],
      },
    ]);
    tx.cart.updateMany.mockResolvedValue({ count: 1 });
    tx.flashSale.findUnique.mockResolvedValue({
      id: 'sale-1',
      availableQuantity: 5,
      soldQuantity: 3,
      finishedAt: null,
      endsAt: new Date(Date.now() + 60_000),
    });
    tx.flashSale.update.mockResolvedValue({
      id: 'sale-1',
      availableQuantity: 7,
      soldQuantity: 3,
    });

    await service.handleExpiredCarts();

    expect(tx.cart.updateMany).toHaveBeenCalledWith({
      where: { id: 'cart-1', status: 'ACTIVE' },
      data: { status: 'EXPIRED' },
    });
    expect(tx.flashSale.update).toHaveBeenCalledWith({
      where: { id: 'sale-1' },
      data: { availableQuantity: { increment: 2 } },
    });
    expect(websocketGateway.emitStockUpdated).toHaveBeenCalledWith(
      'sale-1',
      7,
      3,
    );
  });

  it('should skip processing if another process already expired the cart', async () => {
    prisma.cart.findMany.mockResolvedValue([
      {
        id: 'cart-1',
        items: [{ flashSaleId: 'sale-1', quantity: 2 }],
      },
    ]);
    tx.cart.updateMany.mockResolvedValue({ count: 0 });

    await service.handleExpiredCarts();

    expect(tx.flashSale.findUnique).not.toHaveBeenCalled();
    expect(tx.flashSale.update).not.toHaveBeenCalled();
    expect(websocketGateway.emitStockUpdated).not.toHaveBeenCalled();
  });

  it('should skip stock restoration if the flash sale no longer exists', async () => {
    prisma.cart.findMany.mockResolvedValue([
      {
        id: 'cart-1',
        items: [{ flashSaleId: 'sale-1', quantity: 2 }],
      },
    ]);
    tx.cart.updateMany.mockResolvedValue({ count: 1 });
    tx.flashSale.findUnique.mockResolvedValue(null);

    await service.handleExpiredCarts();

    expect(tx.flashSale.update).not.toHaveBeenCalled();
    expect(websocketGateway.emitStockUpdated).not.toHaveBeenCalled();
  });

  it('should skip stock restoration for a finished flash sale', async () => {
    prisma.cart.findMany.mockResolvedValue([
      {
        id: 'cart-1',
        items: [{ flashSaleId: 'sale-1', quantity: 2 }],
      },
    ]);
    tx.cart.updateMany.mockResolvedValue({ count: 1 });
    tx.flashSale.findUnique.mockResolvedValue({
      id: 'sale-1',
      availableQuantity: 5,
      soldQuantity: 3,
      finishedAt: new Date(),
      endsAt: new Date(Date.now() + 60_000),
    });

    await service.handleExpiredCarts();

    expect(tx.flashSale.update).not.toHaveBeenCalled();
    expect(websocketGateway.emitStockUpdated).not.toHaveBeenCalled();
  });

  it('should skip stock restoration if the flash sale has ended', async () => {
    prisma.cart.findMany.mockResolvedValue([
      {
        id: 'cart-1',
        items: [{ flashSaleId: 'sale-1', quantity: 2 }],
      },
    ]);
    tx.cart.updateMany.mockResolvedValue({ count: 1 });
    tx.flashSale.findUnique.mockResolvedValue({
      id: 'sale-1',
      availableQuantity: 5,
      soldQuantity: 3,
      finishedAt: null,
      endsAt: new Date(Date.now() - 60_000),
    });

    await service.handleExpiredCarts();

    expect(tx.flashSale.update).not.toHaveBeenCalled();
    expect(websocketGateway.emitStockUpdated).not.toHaveBeenCalled();
  });

  it('should process multiple items and restore stock only for eligible sales', async () => {
    prisma.cart.findMany.mockResolvedValue([
      {
        id: 'cart-1',
        items: [
          { flashSaleId: 'sale-active', quantity: 2 },
          { flashSaleId: 'sale-missing', quantity: 1 },
          { flashSaleId: 'sale-finished', quantity: 3 },
        ],
      },
    ]);
    tx.cart.updateMany.mockResolvedValue({ count: 1 });
    tx.flashSale.findUnique
      .mockResolvedValueOnce({
        id: 'sale-active',
        availableQuantity: 5,
        soldQuantity: 3,
        finishedAt: null,
        endsAt: new Date(Date.now() + 60_000),
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'sale-finished',
        availableQuantity: 4,
        soldQuantity: 6,
        finishedAt: new Date(),
        endsAt: new Date(Date.now() + 60_000),
      });
    tx.flashSale.update.mockResolvedValue({
      id: 'sale-active',
      availableQuantity: 7,
      soldQuantity: 3,
    });

    await service.handleExpiredCarts();

    expect(tx.flashSale.findUnique).toHaveBeenCalledTimes(3);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
    expect(tx.flashSale.update).toHaveBeenCalledTimes(1);
    expect(websocketGateway.emitStockUpdated).toHaveBeenCalledTimes(1);
    expect(websocketGateway.emitStockUpdated).toHaveBeenCalledWith(
      'sale-active',
      7,
      3,
    );
  });

  it('should process multiple expired carts', async () => {
    prisma.cart.findMany.mockResolvedValue([
      { id: 'cart-1', items: [] },
      { id: 'cart-2', items: [] },
    ]);
    tx.cart.updateMany.mockResolvedValue({ count: 1 });

    await service.handleExpiredCarts();

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.cart.updateMany).toHaveBeenCalledTimes(2);
  });
});
