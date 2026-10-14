import { Test, TestingModule } from '@nestjs/testing';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';

describe('ProductsController', () => {
  let controller: ProductsController;

  const productsService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findById: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [
        {
          provide: ProductsService,
          useValue: productsService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ProductsController>(ProductsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should pass product fields to ProductsService and return the result', async () => {
      const body = {
        name: 'Flash Sale Product',
        description: 'Test description',
        imageUrl: 'https://example.com/image.png',
      };
      const product = { id: 'product-1', ...body };

      productsService.create.mockResolvedValue(product);

      await expect(controller.create(body)).resolves.toEqual(product);

      expect(productsService.create).toHaveBeenCalledWith(
        body.name,
        body.description,
        body.imageUrl,
      );
    });
  });

  describe('findAll', () => {
    it('should return all products from ProductsService', async () => {
      const products = [{ id: 'product-1', name: 'Product 1' }];

      productsService.findAll.mockResolvedValue(products);

      await expect(controller.findAll()).resolves.toEqual(products);
      expect(productsService.findAll).toHaveBeenCalledTimes(1);
    });
  });

  describe('findById', () => {
    it('should pass the id to ProductsService and return the product', async () => {
      const product = { id: 'product-1', name: 'Product 1' };

      productsService.findById.mockResolvedValue(product);

      await expect(controller.findById('product-1')).resolves.toEqual(product);
      expect(productsService.findById).toHaveBeenCalledWith('product-1');
    });
  });
});
