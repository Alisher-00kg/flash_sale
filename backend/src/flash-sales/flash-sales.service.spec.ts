import { Test, TestingModule } from '@nestjs/testing';
import { FlashSalesService } from './flash-sales.service';
import { PrismaService } from '../prisma/prisma.service';

describe('FlashSalesService', () => {
  let service: FlashSalesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FlashSalesService, { provide: PrismaService, useValue: {} }],
    }).compile();

    service = module.get<FlashSalesService>(FlashSalesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
