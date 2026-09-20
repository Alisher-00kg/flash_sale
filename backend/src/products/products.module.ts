import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [
    PassportModule.register({
      defaultStrategy: 'jwt',
    }),
  ],
  controllers: [ProductsController],
  providers: [ProductsService],
})
export class ProductsModule {}
