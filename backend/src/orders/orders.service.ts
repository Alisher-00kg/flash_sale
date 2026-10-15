import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async createFromCart(userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();

      const cart = await tx.cart.findFirst({
        where: {
          userId,
          status: 'ACTIVE',
          expiresAt: { gt: now },
        },
        include: {
          items: {
            include: {
              flashSale: {
                include: {
                  product: true,
                },
              },
            },
          },
        },
      });

      if (!cart) {
        throw new NotFoundException('Active cart not found or expired');
      }

      if (cart.items.length === 0) {
        throw new BadRequestException('Cart is empty');
      }

      // Claim the cart atomically before creating the order.
      const claimNow = new Date();
      const claimedCart = await tx.cart.updateMany({
        where: {
          id: cart.id,
          userId,
          status: 'ACTIVE',
          expiresAt: { gt: claimNow },
        },
        data: {
          status: 'CHECKED_OUT',
        },
      });

      if (claimedCart.count !== 1) {
        throw new BadRequestException(
          'Cart has expired or has already been checked out',
        );
      }

      const totalAmount = cart.items.reduce(
        (total, item) => total + Number(item.flashSale.price) * item.quantity,
        0,
      );

      return tx.order.create({
        data: {
          userId,
          status: 'PENDING_PAYMENT',
          totalAmount,
          reservedUntil: cart.expiresAt,
          items: {
            create: cart.items.map((item) => ({
              flashSaleId: item.flashSaleId,
              productName: item.flashSale.product.name,
              price: item.flashSale.price,
              quantity: item.quantity,
            })),
          },
        },
        include: {
          items: true,
        },
      });
    });
  }

  async findByUser(userId: string) {
    return this.prisma.order.findMany({
      where: {
        userId,
      },
      include: {
        items: true,
        payment: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}
