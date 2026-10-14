import { Controller, Post, Req, Get, UseGuards } from '@nestjs/common';

import { OrdersService } from './orders.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  createOrder(@Req() request: any) {
    return this.ordersService.createFromCart(request.user.userId);
  }
  @Get()
  @UseGuards(JwtAuthGuard)
  getOrders(@Req() request: any) {
    return this.ordersService.findByUser(request.user.userId);
  }
}
