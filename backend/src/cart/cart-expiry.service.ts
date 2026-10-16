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
        expiresAt: { lte: now },
      },
      select: {
        id: true,
        userId: true,
      },
    });

    for (const candidate of expiredCarts) {
      const result = await this.prisma.$transaction(async (tx) => {
        // Use the same first lock as addToCart and checkout.
        await tx.$queryRaw`
          SELECT id
          FROM "User"
          WHERE id = ${candidate.userId}
          FOR UPDATE
        `;

        const cart = await tx.cart.findUnique({
          where: { id: candidate.id },
          include: { items: true },
        });

        if (
          !cart ||
          cart.status !== 'ACTIVE' ||
          cart.expiresAt > now
        ) {
          return [];
        }

        // Lock sales in a stable order to reduce deadlock risk.
        const flashSaleIds = [
          ...new Set(cart.items.map((item) => item.flashSaleId)),
        ].sort();

        for (const flashSaleId of flashSaleIds) {
          await tx.$queryRaw`
            SELECT id
            FROM "FlashSale"
            WHERE id = ${flashSaleId}
            FOR UPDATE
          `;
        }

        const updatedCart = await tx.cart.updateMany({
          where: {
            id: cart.id,
            status: 'ACTIVE',
            expiresAt: { lte: now },
          },
          data: { status: 'EXPIRED' },
        });

        if (updatedCart.count === 0) {
          return [];
        }

        // Read items again after acquiring locks and claiming the cart.
        const currentItems = await tx.cartItem.findMany({
          where: { cartId: cart.id },
        });

        const updatedFlashSales: {
          flashSaleId: string;
          availableQuantity: number;
          soldQuantity: number;
        }[] = [];

        for (const item of currentItems) {
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

      this.logger.log(`Processed expired cart: ${candidate.id}`);
    }
  }
}
