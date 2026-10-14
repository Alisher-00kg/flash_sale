import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats() {
    const [flashSales, activeCarts, revenue] = await Promise.all([
      this.prisma.flashSale.findMany({
        include: {
          product: true,
        },
        orderBy: {
          startsAt: 'desc',
        },
      }),

      this.prisma.cart.count({
        where: {
          status: 'ACTIVE',
        },
      }),

      this.prisma.order.aggregate({
        where: {
          status: 'PAID',
        },
        _sum: {
          totalAmount: true,
        },
      }),
    ]);

    return {
      stock: flashSales.reduce(
        (total, sale) => total + sale.availableQuantity,
        0,
      ),
      sold: flashSales.reduce((total, sale) => total + sale.soldQuantity, 0),
      carts: activeCarts,
      revenue: revenue._sum.totalAmount ?? 0,
    };
  }
}
