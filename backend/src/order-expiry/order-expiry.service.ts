import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../prisma/prisma.service';
import { WebsocketGateway } from '../websocket/websocket.gateway';

@Injectable()
export class OrderExpiryService {
  private readonly logger = new Logger(OrderExpiryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly websocketGateway: WebsocketGateway,
  ) {}

  @Cron('*/5 * * * * *')
  async handleExpiredOrders() {
    const now = new Date();

    const expiredOrders = await this.prisma.order.findMany({
      where: {
        status: 'PENDING_PAYMENT',
        reservedUntil: {
          lte: now,
        },
      },
      include: {
        items: true,
      },
    });

    for (const order of expiredOrders) {
      const stockUpdates = await this.prisma.$transaction(async (tx) => {
        const updatedOrder = await tx.order.updateMany({
          where: {
            id: order.id,
            status: 'PENDING_PAYMENT',
            reservedUntil: {
              lte: now,
            },
          },
          data: {
            status: 'EXPIRED',
          },
        });

        if (updatedOrder.count === 0) {
          return [];
        }

        const updates: {
          flashSaleId: string;
          availableQuantity: number;
          soldQuantity: number;
        }[] = [];

        for (const item of order.items) {
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
            continue;
          }

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

          updates.push({
            flashSaleId: updatedFlashSale.id,
            availableQuantity: updatedFlashSale.availableQuantity,
            soldQuantity: updatedFlashSale.soldQuantity,
          });
        }

        return updates;
      });

      for (const stock of stockUpdates) {
        this.websocketGateway.emitStockUpdated(
          stock.flashSaleId,
          stock.availableQuantity,
          stock.soldQuantity,
        );
      }

      this.logger.log(`Expired order: ${order.id}`);
    }
  }
}
