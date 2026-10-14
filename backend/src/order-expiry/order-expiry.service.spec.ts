import { Test, TestingModule } from '@nestjs/testing';
import { OrderExpiryService } from './order-expiry.service';
import { PrismaService } from '../prisma/prisma.service';
import { WebsocketGateway } from '../websocket/websocket.gateway';

describe('OrderExpiryService', () => {
  let service: OrderExpiryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderExpiryService,
        { provide: PrismaService, useValue: {} },
        { provide: WebsocketGateway, useValue: {} },
      ],
    }).compile();

    service = module.get<OrderExpiryService>(OrderExpiryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
