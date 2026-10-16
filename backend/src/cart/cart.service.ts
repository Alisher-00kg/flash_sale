import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AddToCartDto } from './dto/add-to-cart.dto';
import { WebsocketGateway } from '../websocket/websocket.gateway';

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly websocketGateway: WebsocketGateway,
  ) {}

  async addToCart(userId: string, dto: AddToCartDto) {
    const result = await this.prisma.$transaction(async (tx) => {
      const now = new Date();

      // Serialize cart changes and checkout for this user.
      await tx.$queryRaw`
        SELECT id
        FROM "User"
        WHERE id = ${userId}
        FOR UPDATE
      `;

      // Serialize stock reservations for this flash sale.
      await tx.$queryRaw`
        SELECT id
        FROM "FlashSale"
        WHERE id = ${dto.flashSaleId}
        FOR UPDATE
      `;

      const flashSale = await tx.flashSale.findUnique({
        where: { id: dto.flashSaleId },
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

      if (flashSale.finishedAt !== null) {
        throw new BadRequestException('Flash sale has finished');
      }

      if (flashSale.availableQuantity < dto.quantity) {
        throw new BadRequestException('Not enough stock');
      }

      let cart = await tx.cart.findFirst({
        where: {
          userId,
          status: 'ACTIVE',
          expiresAt: { gt: now },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!cart) {
        const reservedUntil = new Date(now.getTime() + 10 * 60 * 1000);

        cart = await tx.cart.create({
          data: {
            userId,
            expiresAt: reservedUntil,
          },
        });
      }

      const existingItem = await tx.cartItem.findUnique({
        where: {
          cartId_flashSaleId: {
            cartId: cart.id,
            flashSaleId: flashSale.id,
          },
        },
      });

      if (existingItem) {
        await tx.cartItem.update({
          where: { id: existingItem.id },
          data: {
            quantity: { increment: dto.quantity },
          },
        });
      } else {
        await tx.cartItem.create({
          data: {
            cartId: cart.id,
            flashSaleId: flashSale.id,
            quantity: dto.quantity,
            reservedUntil: cart.expiresAt,
          },
        });
      }

      const updatedFlashSale = await tx.flashSale.update({
        where: { id: flashSale.id },
        data: {
          availableQuantity: { decrement: dto.quantity },
        },
      });

      const updatedCart = await tx.cart.findUniqueOrThrow({
        where: { id: cart.id },
        include: {
          items: {
            include: {
              flashSale: {
                include: { product: true },
              },
            },
          },
        },
      });

      return {
        cart: updatedCart,
        availableQuantity: updatedFlashSale.availableQuantity,
        soldQuantity: updatedFlashSale.soldQuantity,
      };
    });

    this.websocketGateway.emitStockUpdated(
      dto.flashSaleId,
      result.availableQuantity,
      result.soldQuantity,
    );

    return result.cart;
  }

  async getActiveCart(userId: string) {
    const now = new Date();

    return this.prisma.cart.findFirst({
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
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}
