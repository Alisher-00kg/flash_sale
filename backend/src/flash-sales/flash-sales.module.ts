import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { FlashSalesController } from './flash-sales.controller';
import { FlashSalesService } from './flash-sales.service';
import { FlashSaleFinishService } from './flash-sale-finish.service';
import { WebsocketModule } from '../websocket/websocket.module';
import { NotificationsModule } from '../notifications/notifications.module';
@Module({
  imports: [
    PassportModule.register({
      defaultStrategy: 'jwt',
    }),
    WebsocketModule,
    NotificationsModule,
  ],
  controllers: [FlashSalesController],
  providers: [FlashSalesService, FlashSaleFinishService],
})
export class FlashSalesModule {}
