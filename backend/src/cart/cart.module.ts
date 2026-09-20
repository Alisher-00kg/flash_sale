import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { CartExpiryService } from './cart-expiry.service';

@Module({
  imports: [
    PassportModule.register({
      defaultStrategy: 'jwt',
    }),
  ],
  controllers: [CartController],
  providers: [CartService, CartExpiryService],
})
export class CartModule {}
