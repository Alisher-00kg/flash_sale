import { Test, TestingModule } from '@nestjs/testing';
import { OrderExpiryService } from './order-expiry.service';

describe('OrderExpiryService', () => {
  let service: OrderExpiryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [OrderExpiryService],
    }).compile();

    service = module.get<OrderExpiryService>(OrderExpiryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
