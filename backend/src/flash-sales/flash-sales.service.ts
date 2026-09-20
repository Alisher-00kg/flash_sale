import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFlashSaleDto } from './dto/create-flash-sale.dto';

@Injectable()
export class FlashSalesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateFlashSaleDto) {
    const product = await this.prisma.product.findUnique({
      where: {
        id: dto.productId,
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);

    if (endsAt <= startsAt) {
      throw new BadRequestException('endsAt must be later than startsAt');
    }

    return this.prisma.flashSale.create({
      data: {
        productId: dto.productId,
        price: dto.price,
        totalQuantity: dto.totalQuantity,
        availableQuantity: dto.totalQuantity,
        startsAt,
        endsAt,
      },
    });
  }

  async findAll() {
    return this.prisma.flashSale.findMany({
      include: {
        product: true,
      },
      orderBy: {
        startsAt: 'asc',
      },
    });
  }

  async findById(id: string) {
    const flashSale = await this.prisma.flashSale.findUnique({
      where: { id },
      include: {
        product: true,
      },
    });

    if (!flashSale) {
      throw new NotFoundException('Flash sale not found');
    }

    return flashSale;
  }
}
