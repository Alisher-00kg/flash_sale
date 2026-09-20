import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { ProductsModule } from './products/products.module';
import { FlashSalesModule } from './flash-sales/flash-sales.module';

@Module({
  imports: [PrismaModule, UsersModule, AuthModule, ProductsModule, FlashSalesModule],
  controllers: [AppController],
})
export class AppModule {}
