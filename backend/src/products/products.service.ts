import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(name: string, description?: string, imageUrl?: string) {
    return this.prisma.product.create({
      data: {
        name,
        description,
        imageUrl,
      },
    });
  }

  async findAll() {
    return this.prisma.product.findMany({
      orderBy: {
        name: 'asc',
      },
    });
  }

  async findById(id: string) {
    return this.prisma.product.findUnique({
      where: { id },
    });
  }
}
