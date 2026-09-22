import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { FlashSalesController } from './flash-sales.controller';
import { FlashSalesService } from './flash-sales.service';
import { FlashSaleFinishService } from './flash-sale-finish.service';
import { WebsocketModule } from '../websocket/websocket.module';

@Module({
  imports: [
    PassportModule.register({
      defaultStrategy: 'jwt',
    }),
    WebsocketModule,
  ],
  controllers: [FlashSalesController],
  providers: [FlashSalesService, FlashSaleFinishService],
})
export class FlashSalesModule {}
