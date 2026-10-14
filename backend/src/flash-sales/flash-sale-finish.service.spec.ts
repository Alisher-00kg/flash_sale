import { Test, TestingModule } from '@nestjs/testing';
import { FlashSaleFinishService } from './flash-sale-finish.service';
import { PrismaService } from '../prisma/prisma.service';
import { WebsocketGateway } from '../websocket/websocket.gateway';

describe('FlashSaleFinishService', () => {
  let service: FlashSaleFinishService;
  let prisma: {
    flashSale: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let tx: {
    flashSale: {
      updateMany: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
    cart: {
      findMany: jest.Mock;
      update: jest.Mock;
    };
    cartItem: {
      deleteMany: jest.Mock;
      count: jest.Mock;
    };
  };
  let websocketGateway: { emitStockUpdated: jest.Mock };

  beforeEach(async () => {
    tx = {
      flashSale: {
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      cart: {
        findMany: jest.fn(),
        update: jest.fn(),
      },
      cartItem: {
        deleteMany: jest.fn(),
        count: jest.fn(),
      },
    };

    prisma = {
      flashSale: {
        findMany: jest.fn(),
      },
      $transaction: jest.fn((callback) => callback(tx)),
    };

    websocketGateway = {
      emitStockUpdated: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FlashSaleFinishService,
        { provide: PrismaService, useValue: prisma },
        { provide: WebsocketGateway, useValue: websocketGateway },
      ],
    }).compile();

    service = module.get<FlashSaleFinishService>(FlashSaleFinishService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should do nothing when no flash sales have finished', async () => {
    prisma.flashSale.findMany.mockResolvedValue([]);

    await service.handleFinishedFlashSales();

    expect(prisma.flashSale.findMany).toHaveBeenCalledWith({
      where: {
        endsAt: { lte: expect.any(Date) },
        finishedAt: null,
      },
      select: {
        id: true,
        availableQuantity: true,
        soldQuantity: true,
      },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(websocketGateway.emitStockUpdated).not.toHaveBeenCalled();
  });

  it('should finish a sale, set available stock to zero and emit an update', async () => {
    prisma.flashSale.findMany.mockResolvedValue([
      {
        id: 'sale-1',
        availableQuantity: 5,
        soldQuantity: 3,
      },
    ]);
    tx.flashSale.updateMany.mockResolvedValue({ count: 1 });
    tx.cart.findMany.mockResolvedValue([]);
    tx.flashSale.findUniqueOrThrow.mockResolvedValue({
      id: 'sale-1',
      availableQuantity: 0,
      soldQuantity: 3,
    });

    await service.handleFinishedFlashSales();

    expect(tx.flashSale.updateMany).toHaveBeenCalledWith({
      where: { id: 'sale-1', finishedAt: null },
      data: {
        availableQuantity: 0,
        finishedAt: expect.any(Date),
      },
    });
    expect(websocketGateway.emitStockUpdated).toHaveBeenCalledWith(
      'sale-1',
      0,
      3,
    );
  });

  it('should skip processing when the sale was already finished by another process', async () => {
    prisma.flashSale.findMany.mockResolvedValue([
      {
        id: 'sale-1',
        availableQuantity: 5,
        soldQuantity: 3,
      },
    ]);
    tx.flashSale.updateMany.mockResolvedValue({ count: 0 });

    await service.handleFinishedFlashSales();

    expect(tx.cart.findMany).not.toHaveBeenCalled();
    expect(tx.flashSale.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(websocketGateway.emitStockUpdated).not.toHaveBeenCalled();
  });

  it('should remove the sale from active carts and expire carts that become empty', async () => {
    prisma.flashSale.findMany.mockResolvedValue([
      {
        id: 'sale-1',
        availableQuantity: 5,
        soldQuantity: 3,
      },
    ]);
    tx.flashSale.updateMany.mockResolvedValue({ count: 1 });
    tx.cart.findMany.mockResolvedValue([
      { id: 'cart-empty' },
      { id: 'cart-has-other-items' },
    ]);
    tx.cartItem.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);
    tx.flashSale.findUniqueOrThrow.mockResolvedValue({
      id: 'sale-1',
      availableQuantity: 0,
      soldQuantity: 3,
    });

    await service.handleFinishedFlashSales();

    expect(tx.cart.findMany).toHaveBeenCalledWith({
      where: {
        status: 'ACTIVE',
        items: { some: { flashSaleId: 'sale-1' } },
      },
      select: { id: true },
    });
    expect(tx.cartItem.deleteMany).toHaveBeenCalledTimes(2);
    expect(tx.cartItem.deleteMany).toHaveBeenCalledWith({
      where: { cartId: 'cart-empty', flashSaleId: 'sale-1' },
    });
    expect(tx.cart.update).toHaveBeenCalledTimes(1);
    expect(tx.cart.update).toHaveBeenCalledWith({
      where: { id: 'cart-empty' },
      data: { status: 'EXPIRED' },
    });
    expect(websocketGateway.emitStockUpdated).toHaveBeenCalledWith(
      'sale-1',
      0,
      3,
    );
  });

  it('should process multiple finished sales', async () => {
    prisma.flashSale.findMany.mockResolvedValue([
      { id: 'sale-1', availableQuantity: 5, soldQuantity: 3 },
      { id: 'sale-2', availableQuantity: 2, soldQuantity: 8 },
    ]);
    tx.flashSale.updateMany.mockResolvedValue({ count: 1 });
    tx.cart.findMany.mockResolvedValue([]);
    tx.flashSale.findUniqueOrThrow
      .mockResolvedValueOnce({
        id: 'sale-1',
        availableQuantity: 0,
        soldQuantity: 3,
      })
      .mockResolvedValueOnce({
        id: 'sale-2',
        availableQuantity: 0,
        soldQuantity: 8,
      });

    await service.handleFinishedFlashSales();

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(websocketGateway.emitStockUpdated).toHaveBeenCalledTimes(2);
  });
});