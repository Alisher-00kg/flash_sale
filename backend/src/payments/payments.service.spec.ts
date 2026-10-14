import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { NotificationsService } from '../notifications/notifications.service';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: any;
  let websocketGateway: { emitStockUpdated: jest.Mock };
  let notificationsService: { sendEmail: jest.Mock };

  const userId = 'user-1';
  const orderId = 'order-1';
  const paymentId = 'payment-1';
  const flashSaleId = 'sale-1';

  const makePayment = (status = 'PENDING') => ({
    id: paymentId,
    orderId,
    status,
    order: {
      id: orderId,
      userId,
      status: 'PAYMENT_PROCESSING',
      totalAmount: 100,
      items: [{ flashSaleId, quantity: 1 }],
    },
  });

  beforeEach(async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      payment: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      order: {
        update: jest.fn().mockResolvedValue({}),
      },
      flashSale: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    prisma = {
      payment: {
        findUnique: jest.fn(),
      },
      order: {
        findUnique: jest.fn(),
      },
      $transaction: jest.fn(async (callback: (tx: any) => unknown) =>
        callback(tx),
      ),
      tx,
    };

    websocketGateway = {
      emitStockUpdated: jest.fn(),
    };

    notificationsService = {
      sendEmail: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: WebsocketGateway, useValue: websocketGateway },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should mark the order as PAID and update stock after successful payment', async () => {
    const payment = makePayment();
    prisma.payment.findUnique.mockResolvedValue(payment);
    prisma.tx.payment.findUnique.mockResolvedValue(payment);
    prisma.tx.flashSale.findUnique.mockResolvedValue({
      id: flashSaleId,
      availableQuantity: 4,
      soldQuantity: 1,
      finishedAt: null,
      endsAt: new Date(Date.now() + 60_000),
    });
    prisma.tx.flashSale.update.mockResolvedValue({
      id: flashSaleId,
      availableQuantity: 4,
      soldQuantity: 2,
    });
    prisma.order.findUnique.mockResolvedValue({
      id: orderId,
      totalAmount: 100,
      user: { email: 'buyer@example.com' },
    });

    const result = await service.processMockPayment(userId, orderId, 'SUCCESS');

    expect(result).toMatchObject({
      orderId,
      orderStatus: 'PAID',
      paymentStatus: 'SUCCESS',
    });
    expect(prisma.tx.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'SUCCESS' }),
      }),
    );
    expect(prisma.tx.order.update).toHaveBeenCalledWith({
      where: { id: orderId },
      data: { status: 'PAID' },
    });
    expect(prisma.tx.flashSale.update).toHaveBeenCalledTimes(1);
    expect(websocketGateway.emitStockUpdated).toHaveBeenCalledTimes(1);
    expect(notificationsService.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('should mark the order as PAYMENT_FAILED when payment fails', async () => {
    const payment = makePayment();
    prisma.payment.findUnique.mockResolvedValue(payment);
    prisma.tx.payment.findUnique.mockResolvedValue(payment);
    prisma.tx.flashSale.findUnique.mockResolvedValue({
      id: flashSaleId,
      availableQuantity: 3,
      soldQuantity: 0,
      finishedAt: null,
      endsAt: new Date(Date.now() + 60_000),
    });
    prisma.tx.flashSale.update.mockResolvedValue({
      id: flashSaleId,
      availableQuantity: 4,
      soldQuantity: 0,
    });

    const result = await service.processMockPayment(userId, orderId, 'FAILED');

    expect(result).toMatchObject({
      orderId,
      orderStatus: 'PAYMENT_FAILED',
      paymentStatus: 'FAILED',
    });
    expect(prisma.tx.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'FAILED' },
      }),
    );
    expect(prisma.tx.order.update).toHaveBeenCalledWith({
      where: { id: orderId },
      data: { status: 'PAYMENT_FAILED' },
    });
    expect(prisma.tx.flashSale.update).toHaveBeenCalledTimes(1);
    expect(notificationsService.sendEmail).not.toHaveBeenCalled();
  });

  it('should not update stock or send email when payment was already processed', async () => {
    prisma.payment.findUnique.mockResolvedValue({
      ...makePayment('SUCCESS'),
      order: {
        ...makePayment('SUCCESS').order,
        status: 'PAID',
      },
    });

    const result = await service.processMockPayment(userId, orderId, 'SUCCESS');

    expect(result).toMatchObject({
      orderId,
      orderStatus: 'PAID',
      paymentStatus: 'SUCCESS',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(websocketGateway.emitStockUpdated).not.toHaveBeenCalled();
    expect(notificationsService.sendEmail).not.toHaveBeenCalled();
  });
});
