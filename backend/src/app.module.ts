import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { ProductsModule } from './products/products.module';
import { FlashSalesModule } from './flash-sales/flash-sales.module';
import { CartModule } from './cart/cart.module';
import { ScheduleModule } from '@nestjs/schedule';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { WebsocketGateway } from './websocket/websocket.gateway';
import { WebsocketModule } from './websocket/websocket.module';
import { OrderExpiryModule } from './order-expiry/order-expiry.module';

@Module({
  imports: [
    PrismaModule,
    UsersModule,
    AuthModule,
    ProductsModule,
    FlashSalesModule,
    CartModule,
    ScheduleModule.forRoot(),
    OrdersModule,
    PaymentsModule,
    WebsocketModule,
    OrderExpiryModule,
  ],
  controllers: [AppController],
  providers: [WebsocketGateway],
})
export class AppModule {}
