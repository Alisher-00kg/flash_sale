import { Test, TestingModule } from '@nestjs/testing';
import { ProductsService } from './products.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ProductsService', () => {
  let service: ProductsService;

  const prisma = {
    product: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a product with all fields', async () => {
      const product = {
        id: 'product-1',
        name: 'Phone',
        description: 'Test phone',
        imageUrl: 'https://example.com/phone.png',
      };

      prisma.product.create.mockResolvedValue(product);

      await expect(
        service.create('Phone', 'Test phone', 'https://example.com/phone.png'),
      ).resolves.toEqual(product);

      expect(prisma.product.create).toHaveBeenCalledWith({
        data: {
          name: 'Phone',
          description: 'Test phone',
          imageUrl: 'https://example.com/phone.png',
        },
      });
    });

    it('should allow optional fields to be omitted', async () => {
      const product = { id: 'product-2', name: 'Book' };
      prisma.product.create.mockResolvedValue(product);

      await expect(service.create('Book')).resolves.toEqual(product);

      expect(prisma.product.create).toHaveBeenCalledWith({
        data: {
          name: 'Book',
          description: undefined,
          imageUrl: undefined,
        },
      });
    });

    it('should propagate Prisma errors', async () => {
      prisma.product.create.mockRejectedValue(new Error('Create failed'));

      await expect(service.create('Phone')).rejects.toThrow('Create failed');
    });
  });

  describe('findAll', () => {
    it('should return products ordered by name ascending', async () => {
      const products = [
        { id: 'product-1', name: 'Book' },
        { id: 'product-2', name: 'Phone' },
      ];

      prisma.product.findMany.mockResolvedValue(products);

      await expect(service.findAll()).resolves.toEqual(products);

      expect(prisma.product.findMany).toHaveBeenCalledWith({
        orderBy: { name: 'asc' },
      });
    });

    it('should return an empty array when no products exist', async () => {
      prisma.product.findMany.mockResolvedValue([]);

      await expect(service.findAll()).resolves.toEqual([]);
    });

    it('should propagate Prisma errors', async () => {
      prisma.product.findMany.mockRejectedValue(new Error('Find failed'));

      await expect(service.findAll()).rejects.toThrow('Find failed');
    });
  });

  describe('findById', () => {
    it('should return a product by id', async () => {
      const product = { id: 'product-1', name: 'Phone' };
      prisma.product.findUnique.mockResolvedValue(product);

      await expect(service.findById('product-1')).resolves.toEqual(product);

      expect(prisma.product.findUnique).toHaveBeenCalledWith({
        where: { id: 'product-1' },
      });
    });

    it('should return null when the product is not found', async () => {
      prisma.product.findUnique.mockResolvedValue(null);

      await expect(service.findById('missing-id')).resolves.toBeNull();
    });

    it('should propagate Prisma errors', async () => {
      prisma.product.findUnique.mockRejectedValue(
        new Error('Find by id failed'),
      );

      await expect(service.findById('product-1')).rejects.toThrow(
        'Find by id failed',
      );
    });
  });
});
