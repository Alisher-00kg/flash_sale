import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WebsocketGateway } from '../websocket/websocket.gateway';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly websocketGateway: WebsocketGateway,
  ) {}

  async startPayment(userId: string, orderId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id
        FROM "Order"
        WHERE id = ${orderId}
        FOR UPDATE
      `;

      const order = await tx.order.findUnique({
        where: {
          id: orderId,
        },
        include: {
          payment: true,
        },
      });

      if (!order) {
        throw new NotFoundException('Order not found');
      }

      if (order.userId !== userId) {
        throw new ForbiddenException('You cannot pay this order');
      }
      if (order.status === 'PENDING_PAYMENT') {
        if (order.reservedUntil <= new Date()) {
          throw new BadRequestException('Order reservation has expired');
        }
      }
      if (order.status === 'PAID') {
        return {
          orderId: order.id,
          orderStatus: order.status,
          payment: order.payment,
        };
      }

      if (order.status === 'PAYMENT_PROCESSING') {
        return {
          orderId: order.id,
          orderStatus: order.status,
          payment: order.payment,
        };
      }

      if (order.status !== 'PENDING_PAYMENT') {
        throw new BadRequestException(
          `Cannot start payment for order with status ${order.status}`,
        );
      }

      const payment = await tx.payment.upsert({
        where: {
          orderId: order.id,
        },
        create: {
          orderId: order.id,
          status: 'PENDING',
        },
        update: {
          status: 'PENDING',
        },
      });

      const updatedOrder = await tx.order.update({
        where: {
          id: order.id,
        },
        data: {
          status: 'PAYMENT_PROCESSING',
        },
      });

      return {
        orderId: updatedOrder.id,
        orderStatus: updatedOrder.status,
        payment,
      };
    });
  }
  async processMockPayment(
    userId: string,
    orderId: string,
    result: 'SUCCESS' | 'FAILED' | 'PENDING',
    delayMs = 0,
  ) {
    const payment = await this.prisma.payment.findUnique({
      where: {
        orderId,
      },
      include: {
        order: true,
      },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    if (payment.order.userId !== userId) {
      throw new ForbiddenException('You cannot process this payment');
    }

    if (payment.status !== 'PENDING') {
      return {
        orderId,
        orderStatus: payment.order.status,
        paymentStatus: payment.status,
      };
    }

    if (result === 'PENDING') {
      return {
        orderId,
        orderStatus: payment.order.status,
        paymentStatus: payment.status,
        message: 'Payment is still pending',
      };
    }

    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    const paymentResult: {
      orderId: string;
      orderStatus: string;
      paymentStatus: string;
      stockUpdates?: {
        flashSaleId: string;
        availableQuantity: number;
        soldQuantity: number;
      }[];
    } = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
      SELECT id
      FROM "Payment"
      WHERE id = ${payment.id}
      FOR UPDATE
    `;

      const currentPayment = await tx.payment.findUnique({
        where: {
          id: payment.id,
        },
        include: {
          order: {
            include: {
              items: true,
            },
          },
        },
      });

      if (!currentPayment) {
        throw new NotFoundException('Payment not found');
      }

      if (currentPayment.status !== 'PENDING') {
        return {
          orderId,
          orderStatus: currentPayment.order.status,
          paymentStatus: currentPayment.status,
        };
      }

      if (result === 'SUCCESS') {
        await tx.payment.update({
          where: {
            id: currentPayment.id,
          },
          data: {
            status: 'SUCCESS',
            externalId: `mock-${currentPayment.id}`,
          },
        });

        await tx.order.update({
          where: {
            id: orderId,
          },
          data: {
            status: 'PAID',
          },
        });

        const stockUpdates: {
          flashSaleId: string;
          availableQuantity: number;
          soldQuantity: number;
        }[] = [];

        for (const item of currentPayment.order.items) {
          await tx.$queryRaw`
          SELECT id
          FROM "FlashSale"
          WHERE id = ${item.flashSaleId}
          FOR UPDATE
        `;

          const flashSale = await tx.flashSale.update({
            where: {
              id: item.flashSaleId,
            },
            data: {
              soldQuantity: {
                increment: item.quantity,
              },
            },
          });

          stockUpdates.push({
            flashSaleId: flashSale.id,
            availableQuantity: flashSale.availableQuantity,
            soldQuantity: flashSale.soldQuantity,
          });
        }

        return {
          orderId,
          orderStatus: 'PAID',
          paymentStatus: 'SUCCESS',
          stockUpdates,
        };
      }

      await tx.payment.update({
        where: {
          id: currentPayment.id,
        },
        data: {
          status: 'FAILED',
        },
      });

      await tx.order.update({
        where: {
          id: orderId,
        },
        data: {
          status: 'PAYMENT_FAILED',
        },
      });

      const stockUpdates: {
        flashSaleId: string;
        availableQuantity: number;
        soldQuantity: number;
      }[] = [];

      for (const item of currentPayment.order.items) {
        await tx.$queryRaw`
        SELECT id
        FROM "FlashSale"
        WHERE id = ${item.flashSaleId}
        FOR UPDATE
      `;

        const flashSale = await tx.flashSale.findUnique({
          where: {
            id: item.flashSaleId,
          },
        });

        if (!flashSale) {
          throw new NotFoundException('Flash sale not found');
        }

        const now = new Date();

        if (flashSale.finishedAt !== null || now >= flashSale.endsAt) {
          continue;
        }

        const updatedFlashSale = await tx.flashSale.update({
          where: {
            id: item.flashSaleId,
          },
          data: {
            availableQuantity: {
              increment: item.quantity,
            },
          },
        });

        stockUpdates.push({
          flashSaleId: updatedFlashSale.id,
          availableQuantity: updatedFlashSale.availableQuantity,
          soldQuantity: updatedFlashSale.soldQuantity,
        });
      }

      return {
        orderId,
        orderStatus: 'PAYMENT_FAILED',
        paymentStatus: 'FAILED',
        stockUpdates,
      };
    });

    if (paymentResult.stockUpdates) {
      for (const stock of paymentResult.stockUpdates) {
        this.websocketGateway.emitStockUpdated(
          stock.flashSaleId,
          stock.availableQuantity,
          stock.soldQuantity,
        );
      }
    }

    return paymentResult;
  }
}
