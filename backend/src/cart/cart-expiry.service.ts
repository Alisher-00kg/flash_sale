import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { WebsocketGateway } from '../websocket/websocket.gateway';

@Injectable()
export class CartExpiryService {
  private readonly logger = new Logger(CartExpiryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly websocketGateway: WebsocketGateway,
  ) {}

  @Cron('*/5 * * * * *')
  async handleExpiredCarts() {
    const now = new Date();

    const expiredCarts = await this.prisma.cart.findMany({
      where: {
        status: 'ACTIVE',
        expiresAt: {
          lte: now,
        },
      },
      include: {
        items: true,
      },
    });

    for (const cart of expiredCarts) {
      const result = await this.prisma.$transaction(async (tx) => {
        const updatedCart = await tx.cart.updateMany({
          where: {
            id: cart.id,
            status: 'ACTIVE',
          },
          data: {
            status: 'EXPIRED',
          },
        });

        if (updatedCart.count === 0) {
          return [];
        }

        const updatedFlashSales: {
          flashSaleId: string;
          availableQuantity: number;
          soldQuantity: number;
        }[] = [];

        for (const item of cart.items) {
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

          updatedFlashSales.push({
            flashSaleId: updatedFlashSale.id,
            availableQuantity: updatedFlashSale.availableQuantity,
            soldQuantity: updatedFlashSale.soldQuantity,
          });
        }
        return updatedFlashSales;
      });

      for (const flashSale of result) {
        this.websocketGateway.emitStockUpdated(
          flashSale.flashSaleId,
          flashSale.availableQuantity,
          flashSale.soldQuantity,
        );
      }

      this.logger.log(`Expired cart: ${cart.id}`);
    }
  }
}
