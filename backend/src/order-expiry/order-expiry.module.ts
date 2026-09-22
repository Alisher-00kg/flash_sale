import { Module } from '@nestjs/common';

import { OrderExpiryService } from './order-expiry.service';
import { PrismaModule } from '../prisma/prisma.module';
import { WebsocketModule } from '../websocket/websocket.module';

@Module({
  imports: [PrismaModule, WebsocketModule],
  providers: [OrderExpiryService],
})
export class OrderExpiryModule {}
