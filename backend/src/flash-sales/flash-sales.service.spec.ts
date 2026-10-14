import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FlashSalesService } from './flash-sales.service';
import { PrismaService } from '../prisma/prisma.service';

describe('FlashSalesService', () => {
  let service: FlashSalesService;
  let prisma: {
    product: { findUnique: jest.Mock };
    flashSale: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
    };
  };

  const dto = {
    productId: 'product-1',
    price: 100,
    totalQuantity: 10,
    startsAt: '2030-01-01T10:00:00.000Z',
    endsAt: '2030-01-01T12:00:00.000Z',
  };

  beforeEach(async () => {
    prisma = {
      product: {
        findUnique: jest.fn(),
      },
      flashSale: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FlashSalesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<FlashSalesService>(FlashSalesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create a flash sale with the product and initial quantity', async () => {
    const product = { id: dto.productId, name: 'Product A' };
    const flashSale = { id: 'sale-1', ...dto };

    prisma.product.findUnique.mockResolvedValue(product);
    prisma.flashSale.create.mockResolvedValue(flashSale);

    const result = await service.create(dto);

    expect(result).toEqual(flashSale);
    expect(prisma.product.findUnique).toHaveBeenCalledWith({
      where: { id: dto.productId },
    });
    expect(prisma.flashSale.create).toHaveBeenCalledWith({
      data: {
        productId: dto.productId,
        price: dto.price,
        totalQuantity: dto.totalQuantity,
        availableQuantity: dto.totalQuantity,
        startsAt: new Date(dto.startsAt),
        endsAt: new Date(dto.endsAt),
      },
    });
  });

  it('should throw when the product does not exist', async () => {
    prisma.product.findUnique.mockResolvedValue(null);

    await expect(service.create(dto)).rejects.toThrow(NotFoundException);
    expect(prisma.flashSale.create).not.toHaveBeenCalled();
  });

  it('should throw when endsAt is earlier than startsAt', async () => {
    prisma.product.findUnique.mockResolvedValue({ id: dto.productId });

    await expect(
      service.create({
        ...dto,
        startsAt: '2030-01-01T12:00:00.000Z',
        endsAt: '2030-01-01T10:00:00.000Z',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.flashSale.create).not.toHaveBeenCalled();
  });

  it('should throw when endsAt equals startsAt', async () => {
    prisma.product.findUnique.mockResolvedValue({ id: dto.productId });

    await expect(
      service.create({
        ...dto,
        endsAt: dto.startsAt,
      }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.flashSale.create).not.toHaveBeenCalled();
  });

  it('should return all flash sales with products ordered by start time', async () => {
    const sales = [{ id: 'sale-1' }, { id: 'sale-2' }];
    prisma.flashSale.findMany.mockResolvedValue(sales);

    const result = await service.findAll();

    expect(result).toEqual(sales);
    expect(prisma.flashSale.findMany).toHaveBeenCalledWith({
      include: { product: true },
      orderBy: { startsAt: 'asc' },
    });
  });

  it('should return a flash sale by ID with its product', async () => {
    const sale = { id: 'sale-1', product: { id: dto.productId } };
    prisma.flashSale.findUnique.mockResolvedValue(sale);

    const result = await service.findById('sale-1');

    expect(result).toEqual(sale);
    expect(prisma.flashSale.findUnique).toHaveBeenCalledWith({
      where: { id: 'sale-1' },
      include: { product: true },
    });
  });

  it('should throw when the flash sale ID is not found', async () => {
    prisma.flashSale.findUnique.mockResolvedValue(null);

    await expect(service.findById('missing-sale')).rejects.toThrow(
      NotFoundException,
    );
  });
});
