import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AddToCartDto } from './dto/add-to-cart.dto';

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  async addToCart(userId: string, dto: AddToCartDto) {
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
  SELECT id
  FROM "FlashSale"
  WHERE id = ${dto.flashSaleId}
  FOR UPDATE
`;

      const flashSale = await tx.flashSale.findUnique({
        where: {
          id: dto.flashSaleId,
        },
      });

      if (!flashSale) {
        throw new NotFoundException('Flash sale not found');
      }

      if (now < flashSale.startsAt) {
        throw new BadRequestException('Flash sale has not started');
      }

      if (now >= flashSale.endsAt) {
        throw new BadRequestException('Flash sale has ended');
      }

      if (flashSale.availableQuantity < dto.quantity) {
        throw new BadRequestException('Not enough stock');
      }

      const reservedUntil = new Date(now.getTime() + 10 * 60 * 1000);

      const cart = await tx.cart.create({
        data: {
          userId,
          expiresAt: reservedUntil,
          items: {
            create: {
              flashSaleId: flashSale.id,
              quantity: dto.quantity,
              reservedUntil,
            },
          },
        },
        include: {
          items: true,
        },
      });

      await tx.flashSale.update({
        where: {
          id: flashSale.id,
        },
        data: {
          availableQuantity: {
            decrement: dto.quantity,
          },
        },
      });

      return cart;
    });
  }
  async getActiveCart(userId: string) {
    return this.prisma.cart.findFirst({
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
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}
