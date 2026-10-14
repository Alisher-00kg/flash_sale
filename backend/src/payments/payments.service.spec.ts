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
        upsert: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      order: {
        findUnique: jest.fn(),
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
  it('should throw NotFoundException when order does not exist', async () => {
    prisma.tx.order.findUnique.mockResolvedValue(null);

    await expect(service.startPayment(userId, orderId)).rejects.toThrow(
      'Order not found',
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.tx.payment.upsert).not.toHaveBeenCalled();
  });
  it('should throw ForbiddenException when order belongs to another user', async () => {
    prisma.tx.order.findUnique.mockResolvedValue({
      id: orderId,
      userId: 'another-user',
      status: 'PENDING_PAYMENT',
      reservedUntil: new Date(Date.now() + 60_000),
      payment: null,
    });

    await expect(service.startPayment(userId, orderId)).rejects.toThrow(
      'You cannot pay this order',
    );

    expect(prisma.tx.payment.upsert).not.toHaveBeenCalled();
    expect(prisma.tx.order.update).not.toHaveBeenCalled();
  });
  it('should throw BadRequestException when order reservation has expired', async () => {
    prisma.tx.order.findUnique.mockResolvedValue({
      id: orderId,
      userId,
      status: 'PENDING_PAYMENT',
      reservedUntil: new Date(Date.now() - 60_000),
      payment: null,
    });

    await expect(service.startPayment(userId, orderId)).rejects.toThrow(
      'Order reservation has expired',
    );

    expect(prisma.tx.payment.upsert).not.toHaveBeenCalled();
    expect(prisma.tx.order.update).not.toHaveBeenCalled();
  });
  it('should return existing payment when order is already PAID', async () => {
    const existingPayment = { id: paymentId, status: 'SUCCESS' };

    prisma.tx.order.findUnique.mockResolvedValue({
      id: orderId,
      userId,
      status: 'PAID',
      payment: existingPayment,
    });

    const result = await service.startPayment(userId, orderId);

    expect(result).toEqual({
      orderId,
      orderStatus: 'PAID',
      payment: existingPayment,
    });
    expect(prisma.tx.payment.upsert).not.toHaveBeenCalled();
    expect(prisma.tx.order.update).not.toHaveBeenCalled();
  });
  it('should return existing payment when order is PAYMENT_PROCESSING', async () => {
    const existingPayment = { id: paymentId, status: 'PENDING' };

    prisma.tx.order.findUnique.mockResolvedValue({
      id: orderId,
      userId,
      status: 'PAYMENT_PROCESSING',
      payment: existingPayment,
    });

    const result = await service.startPayment(userId, orderId);

    expect(result).toEqual({
      orderId,
      orderStatus: 'PAYMENT_PROCESSING',
      payment: existingPayment,
    });
    expect(prisma.tx.payment.upsert).not.toHaveBeenCalled();
    expect(prisma.tx.order.update).not.toHaveBeenCalled();
  });
  it('should create payment for a valid pending order', async () => {
    const order = {
      id: orderId,
      userId,
      status: 'PENDING_PAYMENT',
      reservedUntil: new Date(Date.now() + 60_000),
      payment: null,
    };
    const createdPayment = { id: paymentId, orderId, status: 'PENDING' };
    const updatedOrder = { id: orderId, status: 'PAYMENT_PROCESSING' };

    prisma.tx.order.findUnique.mockResolvedValue(order);
    prisma.tx.payment.upsert.mockResolvedValue(createdPayment);
    prisma.tx.order.update.mockResolvedValue(updatedOrder);

    const result = await service.startPayment(userId, orderId);

    expect(result).toEqual({
      orderId,
      orderStatus: 'PAYMENT_PROCESSING',
      payment: createdPayment,
    });
    expect(prisma.tx.payment.upsert).toHaveBeenCalledWith({
      where: { orderId },
      create: { orderId, status: 'PENDING' },
      update: { status: 'PENDING' },
    });
    expect(prisma.tx.order.update).toHaveBeenCalledWith({
      where: { id: orderId },
      data: { status: 'PAYMENT_PROCESSING' },
    });
  });
  it('should throw BadRequestException when order status is invalid', async () => {
    prisma.tx.order.findUnique.mockResolvedValue({
      id: orderId,
      userId,
      status: 'PAYMENT_FAILED',
      payment: null,
    });

    await expect(service.startPayment(userId, orderId)).rejects.toThrow(
      'Cannot start payment for order with status PAYMENT_FAILED',
    );

    expect(prisma.tx.payment.upsert).not.toHaveBeenCalled();
    expect(prisma.tx.order.update).not.toHaveBeenCalled();
  });
  it('should throw NotFoundException when payment does not exist', async () => {
    prisma.payment.findUnique.mockResolvedValue(null);

    await expect(
      service.processMockPayment(userId, orderId, 'SUCCESS'),
    ).rejects.toThrow('Payment not found');

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(websocketGateway.emitStockUpdated).not.toHaveBeenCalled();
    expect(notificationsService.sendEmail).not.toHaveBeenCalled();
  });
  it('should throw ForbiddenException when payment belongs to another user', async () => {
    prisma.payment.findUnique.mockResolvedValue({
      ...makePayment(),
      order: {
        ...makePayment().order,
        userId: 'another-user',
      },
    });

    await expect(
      service.processMockPayment(userId, orderId, 'SUCCESS'),
    ).rejects.toThrow('You cannot process this payment');

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(websocketGateway.emitStockUpdated).not.toHaveBeenCalled();
    expect(notificationsService.sendEmail).not.toHaveBeenCalled();
  });
  it('should keep payment pending when result is PENDING', async () => {
    prisma.payment.findUnique.mockResolvedValue(makePayment());

    const result = await service.processMockPayment(userId, orderId, 'PENDING');

    expect(result).toMatchObject({
      orderId,
      orderStatus: 'PAYMENT_PROCESSING',
      paymentStatus: 'PENDING',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(websocketGateway.emitStockUpdated).not.toHaveBeenCalled();
    expect(notificationsService.sendEmail).not.toHaveBeenCalled();
  });
  it('should allow a pending payment to be completed later', async () => {
    const payment = makePayment();

    prisma.payment.findUnique
      .mockResolvedValueOnce(payment)
      .mockResolvedValueOnce(payment);

    const pendingResult = await service.processMockPayment(
      userId,
      orderId,
      'PENDING',
    );

    expect(pendingResult).toMatchObject({
      orderId,
      orderStatus: 'PAYMENT_PROCESSING',
      paymentStatus: 'PENDING',
    });

    prisma.payment.findUnique.mockResolvedValue({
      ...payment,
      order: {
        ...payment.order,
        status: 'PAYMENT_PROCESSING',
      },
    });

    prisma.tx.payment.findUnique.mockResolvedValue({
      ...payment,
      order: {
        ...payment.order,
        status: 'PAYMENT_PROCESSING',
      },
    });

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

    const successResult = await service.processMockPayment(
      userId,
      orderId,
      'SUCCESS',
    );

    expect(successResult).toEqual(
      expect.objectContaining({
        orderStatus: 'PAID',
        paymentStatus: 'SUCCESS',
      }),
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
  it('should wait for delay before processing payment', async () => {
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
    prisma.tx.flashSale.update.mockResolvedValue({});
    prisma.order.findUnique.mockResolvedValue(null);

    const start = Date.now();

    await service.processMockPayment(userId, orderId, 'SUCCESS', 50);

    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
  it('should complete payment after reservation expires if payment was already started', async () => {
    const payment = makePayment();

    const expiredReservationPayment = {
      ...payment,
      order: {
        ...payment.order,
        status: 'PAYMENT_PROCESSING',
        reservedUntil: new Date(Date.now() - 60_000),
      },
    };

    prisma.payment.findUnique.mockResolvedValue(expiredReservationPayment);
    prisma.tx.payment.findUnique.mockResolvedValue(expiredReservationPayment);
    prisma.tx.flashSale.findUnique.mockResolvedValue({
      id: flashSaleId,
      availableQuantity: 4,
      soldQuantity: 1,
      finishedAt: null,
      endsAt: new Date(Date.now() + 60_000),
    });
    prisma.tx.flashSale.update.mockResolvedValue({});
    prisma.order.findUnique.mockResolvedValue(null);

    const result = await service.processMockPayment(userId, orderId, 'SUCCESS');

    expect(result).toEqual(
      expect.objectContaining({
        orderStatus: 'PAID',
        paymentStatus: 'SUCCESS',
      }),
    );
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
  it('should keep payment successful when email notification fails', async () => {
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
    prisma.tx.flashSale.update.mockResolvedValue({});
    prisma.order.findUnique.mockResolvedValue({
      id: orderId,
      totalAmount: 100,
      user: { email: 'buyer@example.com' },
    });
    notificationsService.sendEmail.mockRejectedValue(
      new Error('Email service unavailable'),
    );

    const result = await service.processMockPayment(userId, orderId, 'SUCCESS');

    expect(result).toMatchObject({
      orderId,
      orderStatus: 'PAID',
      paymentStatus: 'SUCCESS',
    });
    expect(prisma.tx.order.update).toHaveBeenCalledWith({
      where: { id: orderId },
      data: { status: 'PAID' },
    });
    expect(websocketGateway.emitStockUpdated).toHaveBeenCalled();
    expect(notificationsService.sendEmail).toHaveBeenCalledTimes(1);
  });
  it('should not send email when order is missing after successful payment', async () => {
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
    prisma.tx.flashSale.update.mockResolvedValue({});
    prisma.order.findUnique.mockResolvedValue(null);

    const result = await service.processMockPayment(userId, orderId, 'SUCCESS');

    expect(result).toMatchObject({
      orderId,
      orderStatus: 'PAID',
      paymentStatus: 'SUCCESS',
    });
    expect(prisma.tx.order.update).toHaveBeenCalledWith({
      where: { id: orderId },
      data: { status: 'PAID' },
    });
    expect(websocketGateway.emitStockUpdated).toHaveBeenCalled();
    expect(notificationsService.sendEmail).not.toHaveBeenCalled();
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
  it('should throw NotFoundException when payment disappears before transaction processing', async () => {
    prisma.payment.findUnique.mockResolvedValue(makePayment());
    prisma.tx.payment.findUnique.mockResolvedValue(null);

    await expect(
      service.processMockPayment(userId, orderId, 'SUCCESS'),
    ).rejects.toThrow('Payment not found');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(websocketGateway.emitStockUpdated).not.toHaveBeenCalled();
    expect(notificationsService.sendEmail).not.toHaveBeenCalled();
  });
  it('should throw BadRequestException when order is not processing during successful payment', async () => {
    const payment = {
      ...makePayment(),
      order: {
        ...makePayment().order,
        status: 'PAYMENT_FAILED',
      },
    };

    prisma.payment.findUnique.mockResolvedValue(payment);
    prisma.tx.payment.findUnique.mockResolvedValue(payment);

    await expect(
      service.processMockPayment(userId, orderId, 'SUCCESS'),
    ).rejects.toThrow(
      'Cannot complete payment for order with status PAYMENT_FAILED',
    );

    expect(prisma.tx.flashSale.update).not.toHaveBeenCalled();
    expect(websocketGateway.emitStockUpdated).not.toHaveBeenCalled();
    expect(notificationsService.sendEmail).not.toHaveBeenCalled();
  });
  it('should throw NotFoundException when flash sale is missing during successful payment', async () => {
    const payment = makePayment();

    prisma.payment.findUnique.mockResolvedValue(payment);
    prisma.tx.payment.findUnique.mockResolvedValue(payment);
    prisma.tx.flashSale.findUnique.mockResolvedValue(null);

    await expect(
      service.processMockPayment(userId, orderId, 'SUCCESS'),
    ).rejects.toThrow('Flash sale not found');

    expect(prisma.tx.payment.update).not.toHaveBeenCalled();
    expect(prisma.tx.order.update).not.toHaveBeenCalled();
    expect(websocketGateway.emitStockUpdated).not.toHaveBeenCalled();
    expect(notificationsService.sendEmail).not.toHaveBeenCalled();
  });
  it('should not restore stock when flash sale has already finished after payment failure', async () => {
    const payment = makePayment();

    prisma.payment.findUnique.mockResolvedValue(payment);
    prisma.tx.payment.findUnique.mockResolvedValue(payment);
    prisma.tx.flashSale.findUnique.mockResolvedValue({
      id: flashSaleId,
      availableQuantity: 3,
      soldQuantity: 1,
      finishedAt: new Date(),
      endsAt: new Date(Date.now() + 60_000),
    });

    const result = await service.processMockPayment(userId, orderId, 'FAILED');

    expect(result).toMatchObject({
      orderId,
      orderStatus: 'PAYMENT_FAILED',
      paymentStatus: 'FAILED',
    });
    expect(prisma.tx.payment.update).toHaveBeenCalled();
    expect(prisma.tx.order.update).toHaveBeenCalled();
    expect(prisma.tx.flashSale.update).not.toHaveBeenCalled();
    expect(websocketGateway.emitStockUpdated).not.toHaveBeenCalled();
    expect(notificationsService.sendEmail).not.toHaveBeenCalled();
  });
  it('should not restore stock when flash sale has expired after payment failure', async () => {
    const payment = makePayment();

    prisma.payment.findUnique.mockResolvedValue(payment);
    prisma.tx.payment.findUnique.mockResolvedValue(payment);
    prisma.tx.flashSale.findUnique.mockResolvedValue({
      id: flashSaleId,
      availableQuantity: 3,
      soldQuantity: 1,
      finishedAt: null,
      endsAt: new Date(Date.now() - 60_000),
    });

    const result = await service.processMockPayment(userId, orderId, 'FAILED');

    expect(result).toMatchObject({
      orderId,
      orderStatus: 'PAYMENT_FAILED',
      paymentStatus: 'FAILED',
    });
    expect(prisma.tx.payment.update).toHaveBeenCalled();
    expect(prisma.tx.order.update).toHaveBeenCalled();
    expect(prisma.tx.flashSale.update).not.toHaveBeenCalled();
    expect(websocketGateway.emitStockUpdated).not.toHaveBeenCalled();
    expect(notificationsService.sendEmail).not.toHaveBeenCalled();
  });
  it('should throw NotFoundException when flash sale is missing during failed payment', async () => {
    const payment = makePayment();

    prisma.payment.findUnique.mockResolvedValue(payment);
    prisma.tx.payment.findUnique.mockResolvedValue(payment);
    prisma.tx.flashSale.findUnique.mockResolvedValue(null);

    await expect(
      service.processMockPayment(userId, orderId, 'FAILED'),
    ).rejects.toThrow('Flash sale not found');

    expect(prisma.tx.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: paymentId },
        data: { status: 'FAILED' },
      }),
    );
    expect(prisma.tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: orderId },
        data: { status: 'PAYMENT_FAILED' },
      }),
    );
    expect(websocketGateway.emitStockUpdated).not.toHaveBeenCalled();
    expect(notificationsService.sendEmail).not.toHaveBeenCalled();
  });
  it('should not process payment again when status is not PENDING', async () => {
    prisma.payment.findUnique.mockResolvedValue(makePayment('FAILED'));

    const result = await service.processMockPayment(userId, orderId, 'SUCCESS');

    expect(result).toMatchObject({
      orderId,
      orderStatus: 'PAYMENT_PROCESSING',
      paymentStatus: 'FAILED',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(websocketGateway.emitStockUpdated).not.toHaveBeenCalled();
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
