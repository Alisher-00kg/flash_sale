import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CartExpiryService {
  private readonly logger = new Logger(CartExpiryService.name);

  constructor(private readonly prisma: PrismaService) {}

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
      await this.prisma.$transaction(async (tx) => {
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
          return;
        }

        for (const item of cart.items) {
          await tx.flashSale.update({
            where: {
              id: item.flashSaleId,
            },
            data: {
              availableQuantity: {
                increment: item.quantity,
              },
            },
          });
        }
      });

      this.logger.log(`Expired cart: ${cart.id}`);
    }
  }
}
