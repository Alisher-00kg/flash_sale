import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { FlashSalesController } from './flash-sales.controller';
import { FlashSalesService } from './flash-sales.service';

@Module({
  imports: [
    PassportModule.register({
      defaultStrategy: 'jwt',
    }),
  ],
  controllers: [FlashSalesController],
  providers: [FlashSalesService],
})
export class FlashSalesModule {}
