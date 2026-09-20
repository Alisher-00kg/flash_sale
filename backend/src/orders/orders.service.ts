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
      const cart = await tx.cart.findFirst({
        where: {
          userId,
          status: 'ACTIVE',
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
        throw new NotFoundException('Active cart not found');
      }

      const now = new Date();

      if (cart.expiresAt <= now) {
        throw new BadRequestException('Cart has expired');
      }

      if (cart.items.length === 0) {
        throw new BadRequestException('Cart is empty');
      }

      const totalAmount = cart.items.reduce(
        (total, item) => total + Number(item.flashSale.price) * item.quantity,
        0,
      );

      const order = await tx.order.create({
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

      await tx.cart.update({
        where: {
          id: cart.id,
        },
        data: {
          status: 'CHECKED_OUT',
        },
      });

      return order;
    });
  }
}
