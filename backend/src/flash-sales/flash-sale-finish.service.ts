import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { NotificationsService } from '../notifications/notifications.service';


@Injectable()
export class FlashSaleFinishService {
  private readonly logger = new Logger(FlashSaleFinishService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly websocketGateway: WebsocketGateway,
    private readonly notificationsService: NotificationsService,
  ) {}

  @Cron('*/5 * * * * *')
  async handleFinishedFlashSales() {
    const now = new Date();
    const finishedSales = await this.prisma.flashSale.findMany({
      where: {
        endsAt: {
          lte: now,
        },
        finishedAt: null,
      },

      select: {
        id: true,
        availableQuantity: true,
        soldQuantity: true,
      },
    });

    for (const sale of finishedSales) {
      const result = await this.prisma.$transaction(async (tx) => {
        const updatedSale = await tx.flashSale.updateMany({
          where: {
            id: sale.id,
            finishedAt: null,
          },
          data: {
            availableQuantity: 0,
            finishedAt: now,
          },
        });

        if (updatedSale.count === 0) {
          return null;
        }

        const carts = await tx.cart.findMany({
          where: {
            status: 'ACTIVE',
            items: {
              some: {
                flashSaleId: sale.id,
              },
            },
          },
          select: {
            id: true,
            user: {
              select: {
                email: true,
              },
            },
          },
        });

        const recipientEmails = [
          ...new Set(carts.map((cart) => cart.user.email)),
        ];

        for (const cart of carts) {
          await tx.cartItem.deleteMany({
            where: {
              cartId: cart.id,
              flashSaleId: sale.id,
            },
          });

          const remainingItems = await tx.cartItem.count({
            where: {
              cartId: cart.id,
            },
          });

          if (remainingItems === 0) {
            await tx.cart.update({
              where: {
                id: cart.id,
              },
              data: {
                status: 'EXPIRED',
              },
            });
          }
        }

        const finalSale = await tx.flashSale.findUniqueOrThrow({
          where: { id: sale.id },
          select: {
            id: true,
            availableQuantity: true,
            soldQuantity: true,
          },
        });

        return {
          flashSaleId: finalSale.id,
          availableQuantity: finalSale.availableQuantity,
          soldQuantity: finalSale.soldQuantity,
          recipientEmails,
        };
      });

      if (!result) {
        continue;
      }

      this.websocketGateway.emitStockUpdated(
        result.flashSaleId,
        result.availableQuantity,
        result.soldQuantity,
      );

      this.logger.log(
        `Flash sale finished: ${result.flashSaleId}, available: 0`,
      );

      for (const email of result.recipientEmails) {
        try {
          await this.notificationsService.sendEmail(
            email,
            'Flash sale has ended',
            'A flash sale item in your cart is no longer available because the sale has ended.',
          );
        } catch (error) {
          this.logger.error(
            `Failed to notify ${email} about finished flash sale ${result.flashSaleId}`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }

    }
  }
}
