import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';

import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { WebsocketModule } from '../websocket/websocket.module';

@Module({
  imports: [
    PassportModule.register({
      defaultStrategy: 'jwt',
    }),
    WebsocketModule,
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
