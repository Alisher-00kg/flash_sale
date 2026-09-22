import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { WebsocketGateway } from '../websocket/websocket.gateway';

@Injectable()
export class FlashSaleFinishService {
  private readonly logger = new Logger(FlashSaleFinishService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly websocketGateway: WebsocketGateway,
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
          },
        });

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

        return {
          flashSaleId: sale.id,
          availableQuantity: 0,
        };
      });

      if (!result) {
        continue;
      }

      this.websocketGateway.emitStockUpdated(
        result.flashSaleId,
        result.availableQuantity,
        0,
      );

      this.logger.log(
        `Flash sale finished: ${result.flashSaleId}, available: 0`,
      );
    }
  }
}
