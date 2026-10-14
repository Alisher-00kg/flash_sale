import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { PrismaService } from '../prisma/prisma.service';

describe('OrdersService', () => {
  let service: OrdersService;
  let prisma: any;
  let tx: any;

  const userId = 'user-1';

  const makeCart = (overrides = {}) => ({
    id: 'cart-1',
    expiresAt: new Date(Date.now() + 60_000),
    items: [
      {
        flashSaleId: 'sale-1',
        quantity: 2,
        flashSale: {
          price: 100,
          product: { name: 'Product A' },
        },
      },
      {
        flashSaleId: 'sale-2',
        quantity: 1,
        flashSale: {
          price: 50,
          product: { name: 'Product B' },
        },
      },
    ],
    ...overrides,
  });

  beforeEach(async () => {
    tx = {
      cart: {
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      order: {
        create: jest.fn().mockResolvedValue({
          id: 'order-1',
          totalAmount: 250,
          status: 'PENDING_PAYMENT',
          items: [],
        }),
      },
    };

    prisma = {
      $transaction: jest.fn(async (callback: (tx: any) => unknown) =>
        callback(tx),
      ),
      order: {
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [OrdersService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create an order from the active cart and check out the cart', async () => {
    const cart = makeCart();
    tx.cart.findFirst.mockResolvedValue(cart);

    const result = await service.createFromCart(userId);

    expect(result).toMatchObject({
      id: 'order-1',
      totalAmount: 250,
      status: 'PENDING_PAYMENT',
    });

    expect(tx.order.create).toHaveBeenCalledWith({
      data: {
        userId,
        status: 'PENDING_PAYMENT',
        totalAmount: 250,
        reservedUntil: cart.expiresAt,
        items: {
          create: [
            {
              flashSaleId: 'sale-1',
              productName: 'Product A',
              price: 100,
              quantity: 2,
            },
            {
              flashSaleId: 'sale-2',
              productName: 'Product B',
              price: 50,
              quantity: 1,
            },
          ],
        },
      },
      include: { items: true },
    });

    expect(tx.cart.update).toHaveBeenCalledWith({
      where: { id: 'cart-1' },
      data: { status: 'CHECKED_OUT' },
    });
  });

  it('should throw when the active cart does not exist', async () => {
    tx.cart.findFirst.mockResolvedValue(null);

    await expect(service.createFromCart(userId)).rejects.toThrow(
      NotFoundException,
    );

    expect(tx.order.create).not.toHaveBeenCalled();
    expect(tx.cart.update).not.toHaveBeenCalled();
  });

  it('should throw when the cart has expired', async () => {
    tx.cart.findFirst.mockResolvedValue(
      makeCart({ expiresAt: new Date(Date.now() - 60_000) }),
    );

    await expect(service.createFromCart(userId)).rejects.toThrow(
      BadRequestException,
    );

    expect(tx.order.create).not.toHaveBeenCalled();
  });

  it('should throw when the cart is empty', async () => {
    tx.cart.findFirst.mockResolvedValue(makeCart({ items: [] }));

    await expect(service.createFromCart(userId)).rejects.toThrow(
      BadRequestException,
    );

    expect(tx.order.create).not.toHaveBeenCalled();
  });

  it('should return a user’s orders newest first', async () => {
    const orders = [{ id: 'order-1' }, { id: 'order-2' }];
    prisma.order.findMany.mockResolvedValue(orders);

    const result = await service.findByUser(userId);

    expect(result).toEqual(orders);
    expect(prisma.order.findMany).toHaveBeenCalledWith({
      where: { userId },
      include: { items: true, payment: true },
      orderBy: { createdAt: 'desc' },
    });
  });
});
