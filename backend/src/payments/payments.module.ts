import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';

import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
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
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
