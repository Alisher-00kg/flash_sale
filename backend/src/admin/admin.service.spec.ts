import { Test, TestingModule } from '@nestjs/testing';
import { AdminService } from './admin.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AdminService', () => {
  let service: AdminService;

  const prisma = {
    flashSale: {
      findMany: jest.fn(),
    },
    cart: {
      count: jest.fn(),
    },
    order: {
      aggregate: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [AdminService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return aggregated statistics', async () => {
    prisma.flashSale.findMany.mockResolvedValue([
      { availableQuantity: 10, soldQuantity: 4 },
      { availableQuantity: 5, soldQuantity: 7 },
    ]);
    prisma.cart.count.mockResolvedValue(3);
    prisma.order.aggregate.mockResolvedValue({
      _sum: { totalAmount: 1250 },
    });

    await expect(service.getStats()).resolves.toEqual({
      stock: 15,
      sold: 11,
      carts: 3,
      revenue: 1250,
    });

    expect(prisma.flashSale.findMany).toHaveBeenCalledWith({
      include: { product: true },
      orderBy: { startsAt: 'desc' },
    });
    expect(prisma.cart.count).toHaveBeenCalledWith({
      where: { status: 'ACTIVE' },
    });
    expect(prisma.order.aggregate).toHaveBeenCalledWith({
      where: { status: 'PAID' },
      _sum: { totalAmount: true },
    });
  });

  it('should return zeros when there are no sales, carts, or revenue', async () => {
    prisma.flashSale.findMany.mockResolvedValue([]);
    prisma.cart.count.mockResolvedValue(0);
    prisma.order.aggregate.mockResolvedValue({
      _sum: { totalAmount: null },
    });

    await expect(service.getStats()).resolves.toEqual({
      stock: 0,
      sold: 0,
      carts: 0,
      revenue: 0,
    });
  });

  it('should return zero revenue when the aggregate sum is null', async () => {
    prisma.flashSale.findMany.mockResolvedValue([
      { availableQuantity: 8, soldQuantity: 2 },
    ]);
    prisma.cart.count.mockResolvedValue(1);
    prisma.order.aggregate.mockResolvedValue({
      _sum: { totalAmount: null },
    });

    await expect(service.getStats()).resolves.toEqual({
      stock: 8,
      sold: 2,
      carts: 1,
      revenue: 0,
    });
  });

  it('should propagate an error if fetching flash sales fails', async () => {
    const error = new Error('Database error');
    prisma.flashSale.findMany.mockRejectedValue(error);
    prisma.cart.count.mockResolvedValue(0);
    prisma.order.aggregate.mockResolvedValue({
      _sum: { totalAmount: 0 },
    });

    await expect(service.getStats()).rejects.toThrow('Database error');
  });
  it('should preserve zero revenue', async () => {
    prisma.flashSale.findMany.mockResolvedValue([]);
    prisma.cart.count.mockResolvedValue(0);
    prisma.order.aggregate.mockResolvedValue({
      _sum: { totalAmount: 0 },
    });

    await expect(service.getStats()).resolves.toEqual({
      stock: 0,
      sold: 0,
      carts: 0,
      revenue: 0,
    });
  });
});
