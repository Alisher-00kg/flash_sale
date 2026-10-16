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
        reservedUntil: { lte: now },
      },
      select: { id: true },
    });

    for (const candidate of expiredOrders) {
      const stockUpdates = await this.prisma.$transaction(async (tx) => {
        // Match startPayment's lock order: lock the order first.
        await tx.$queryRaw`
          SELECT id
          FROM "Order"
          WHERE id = ${candidate.id}
          FOR UPDATE
        `;

        const order = await tx.order.findUnique({
          where: { id: candidate.id },
          include: { items: true },
        });

        if (
          !order ||
          order.status !== 'PENDING_PAYMENT' ||
          order.reservedUntil > now
        ) {
          return [];
        }

        const updatedOrder = await tx.order.updateMany({
          where: {
            id: order.id,
            status: 'PENDING_PAYMENT',
            reservedUntil: { lte: now },
          },
          data: { status: 'EXPIRED' },
        });

        if (updatedOrder.count === 0) {
          return [];
        }

        const flashSaleIds = [
          ...new Set(order.items.map((item) => item.flashSaleId)),
        ].sort();

        // Lock flash sales in a stable order.
        for (const flashSaleId of flashSaleIds) {
          await tx.$queryRaw`
            SELECT id
            FROM "FlashSale"
            WHERE id = ${flashSaleId}
            FOR UPDATE
          `;
        }

        const updates: {
          flashSaleId: string;
          availableQuantity: number;
          soldQuantity: number;
        }[] = [];

        for (const item of order.items) {
          const flashSale = await tx.flashSale.findUnique({
            where: { id: item.flashSaleId },
          });

          if (
            !flashSale ||
            flashSale.finishedAt !== null ||
            now >= flashSale.endsAt
          ) {
            continue;
          }

          const updatedFlashSale = await tx.flashSale.update({
            where: { id: item.flashSaleId },
            data: {
              availableQuantity: { increment: item.quantity },
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

      this.logger.log(`Processed expired order: ${candidate.id}`);
    }
  }
}
