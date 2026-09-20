import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PaymentsService } from './payments.service';
import { MockPaymentDto } from './dto/mock-payment.dto';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post(':orderId')
  @UseGuards(JwtAuthGuard)
  startPayment(@Req() request: any, @Param('orderId') orderId: string) {
    return this.paymentsService.startPayment(request.user.userId, orderId);
  }

  @Post(':orderId/mock')
  @UseGuards(JwtAuthGuard)
  mockPayment(
    @Req() request: any,
    @Param('orderId') orderId: string,
    @Body() dto: MockPaymentDto,
  ) {
    return this.paymentsService.processMockPayment(
      request.user.userId,
      orderId,
      dto.result,
      dto.delayMs,
    );
  }
}
