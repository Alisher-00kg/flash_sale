import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';

import { CartService } from './cart.service';
import { AddToCartDto } from './dto/add-to-cart.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Post('items')
  @UseGuards(JwtAuthGuard)
  addToCart(@Req() request: any, @Body() dto: AddToCartDto) {
    return this.cartService.addToCart(request.user.userId, dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  getCart(@Req() request: any) {
    return this.cartService.getActiveCart(request.user.userId);
  }
}
