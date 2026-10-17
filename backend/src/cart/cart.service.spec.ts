import { Test, TestingModule } from '@nestjs/testing';
import { CartService } from './cart.service';
import { PrismaService } from '../prisma/prisma.service';
import { WebsocketGateway } from '../websocket/websocket.gateway';

describe('CartService', () => {
  let service: CartService;
  let prisma: any;
  let tx: any;
  let websocketGateway: { emitStockUpdated: jest.Mock };

  const userId = 'user-1';
  const flashSaleId = 'sale-1';
  const cartId = 'cart-1';
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  const makeFlashSale = (overrides = {}) => ({
    id: flashSaleId,
    startsAt: new Date(Date.now() - 60_000),
    endsAt: new Date(Date.now() + 60 * 60 * 1000),
    finishedAt: null,
    availableQuantity: 10,
    soldQuantity: 0,
    ...overrides,
  });

  const makeCart = (items = []) => ({
    id: cartId,
    userId,
    status: 'ACTIVE',
    expiresAt,
    createdAt: new Date(Date.now() - 60_000),
    items,
  });

  beforeEach(async () => {
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      flashSale: {
        findUnique: jest.fn().mockResolvedValue(makeFlashSale()),
        update: jest.fn().mockResolvedValue({
          availableQuantity: 8,
          soldQuantity: 0,
        }),
      },
      cart: {
        findFirst: jest.fn(),
        create: jest.fn().mockResolvedValue(makeCart()),
        findUniqueOrThrow: jest.fn(),
      },
      cartItem: {
        findUnique: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'item-new' }),
        update: jest.fn().mockResolvedValue({ id: 'item-existing' }),
      },
    };

    prisma = {
      $transaction: jest.fn(async (callback: (tx: any) => unknown) =>
        callback(tx),
      ),
      cart: {
        findFirst: jest.fn(),
      },
    };

    websocketGateway = {
      emitStockUpdated: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CartService,
        { provide: PrismaService, useValue: prisma },
        { provide: WebsocketGateway, useValue: websocketGateway },
      ],
    }).compile();

    service = module.get<CartService>(CartService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should increase an existing item quantity without extending cart expiry', async () => {
    const existingItem = {
      id: 'item-1',
      cartId,
      flashSaleId,
      quantity: 2,
      reservedUntil: expiresAt,
    };

    tx.cart.findFirst.mockResolvedValue(makeCart([existingItem]));
    tx.cartItem.findUnique.mockResolvedValue(existingItem);
    tx.cart.findUniqueOrThrow.mockResolvedValue(
      makeCart([{ ...existingItem, quantity: 5 }]),
    );

    await service.addToCart(userId, { flashSaleId, quantity: 3 });

    expect(tx.cart.create).not.toHaveBeenCalled();
    expect(tx.cartItem.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: { quantity: { increment: 3 } },
    });
    expect(tx.cartItem.create).not.toHaveBeenCalled();
    expect(tx.flashSale.update).toHaveBeenCalledWith({
      where: { id: flashSaleId },
      data: { availableQuantity: { decrement: 3 } },
    });
    expect(websocketGateway.emitStockUpdated).toHaveBeenCalledWith(
      flashSaleId,
      8,
      0,
    );
  });

  it('should add a different item to the existing cart using its original expiry', async () => {
    const otherItem = {
      id: 'item-other',
      cartId,
      flashSaleId: 'sale-other',
      quantity: 1,
      reservedUntil: expiresAt,
    };

    tx.cart.findFirst.mockResolvedValue(makeCart([otherItem]));
    tx.cartItem.findUnique.mockResolvedValue(null);
    tx.cart.findUniqueOrThrow.mockResolvedValue(
      makeCart([otherItem, { id: 'item-new', flashSaleId, quantity: 2 }]),
    );

    await service.addToCart(userId, { flashSaleId, quantity: 2 });

    expect(tx.cart.create).not.toHaveBeenCalled();
    expect(tx.cartItem.create).toHaveBeenCalledWith({
      data: {
        cartId,
        flashSaleId,
        quantity: 2,
        reservedUntil: expiresAt,
      },
    });
  });

  it('should create a cart with a ten-minute expiry when no active cart exists', async () => {
    tx.cart.findFirst.mockResolvedValue(null);
    tx.cartItem.findUnique.mockResolvedValue(null);
    tx.cart.create.mockResolvedValue(makeCart());
    tx.cart.findUniqueOrThrow.mockResolvedValue(makeCart());

    const before = Date.now();
    await service.addToCart(userId, { flashSaleId, quantity: 2 });
    const after = Date.now();

    const createCall = tx.cart.create.mock.calls[0][0];
    const createdExpiry = createCall.data.expiresAt.getTime();

    expect(createdExpiry).toBeGreaterThanOrEqual(before + 10 * 60 * 1000);
    expect(createdExpiry).toBeLessThanOrEqual(after + 10 * 60 * 1000);
    expect(createCall.data.userId).toBe(userId);
    expect(websocketGateway.emitStockUpdated).toHaveBeenCalledTimes(1);
  });

  it('should reject adding an item before the flash sale starts without reserving stock', async () => {
    tx.flashSale.findUnique.mockResolvedValue(
      makeFlashSale({
        startsAt: new Date(Date.now() + 60_000),
      }),
    );

    await expect(
      service.addToCart(userId, { flashSaleId, quantity: 1 }),
    ).rejects.toThrow('Flash sale has not started');

    expect(tx.cart.findFirst).not.toHaveBeenCalled();
    expect(tx.cart.create).not.toHaveBeenCalled();
    expect(tx.cartItem.create).not.toHaveBeenCalled();
    expect(tx.cartItem.update).not.toHaveBeenCalled();
    expect(tx.flashSale.update).not.toHaveBeenCalled();
    expect(websocketGateway.emitStockUpdated).not.toHaveBeenCalled();
  });


  it('should reject adding an item after the flash sale ends without reserving stock', async () => {
    tx.flashSale.findUnique.mockResolvedValue(
      makeFlashSale({
        endsAt: new Date(Date.now() - 60_000),
      }),
    );

    await expect(
      service.addToCart(userId, { flashSaleId, quantity: 1 }),
    ).rejects.toThrow('Flash sale has ended');

    expect(tx.cart.findFirst).not.toHaveBeenCalled();
    expect(tx.cart.create).not.toHaveBeenCalled();
    expect(tx.cartItem.create).not.toHaveBeenCalled();
    expect(tx.cartItem.update).not.toHaveBeenCalled();
    expect(tx.flashSale.update).not.toHaveBeenCalled();
    expect(websocketGateway.emitStockUpdated).not.toHaveBeenCalled();
  });


  it('should reject a reservation that exceeds available stock', async () => {
    tx.flashSale.findUnique.mockResolvedValue(
      makeFlashSale({ availableQuantity: 2 }),
    );

    await expect(
      service.addToCart(userId, { flashSaleId, quantity: 3 }),
    ).rejects.toThrow('Not enough stock');

    expect(tx.cart.findFirst).not.toHaveBeenCalled();
    expect(tx.cart.create).not.toHaveBeenCalled();
    expect(tx.cartItem.create).not.toHaveBeenCalled();
    expect(tx.cartItem.update).not.toHaveBeenCalled();
    expect(tx.flashSale.update).not.toHaveBeenCalled();
    expect(websocketGateway.emitStockUpdated).not.toHaveBeenCalled();
  });


  it('should reject reservations for an already finished flash sale', async () => {
    tx.flashSale.findUnique.mockResolvedValue(
      makeFlashSale({
        finishedAt: new Date(Date.now() - 1_000),
      }),
    );

    await expect(
      service.addToCart(userId, { flashSaleId, quantity: 1 }),
    ).rejects.toThrow('Flash sale has finished');

    expect(tx.cart.findFirst).not.toHaveBeenCalled();
    expect(tx.cart.create).not.toHaveBeenCalled();
    expect(tx.cartItem.create).not.toHaveBeenCalled();
    expect(tx.cartItem.update).not.toHaveBeenCalled();
    expect(tx.flashSale.update).not.toHaveBeenCalled();
    expect(websocketGateway.emitStockUpdated).not.toHaveBeenCalled();
  });

});
