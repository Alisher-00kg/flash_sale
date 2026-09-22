import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class WebsocketGateway {
  @WebSocketServer()
  server: Server;

  emitStockUpdated(
    flashSaleId: string,
    availableQuantity: number,
    soldQuantity: number,
  ) {
    this.server.emit('stock.updated', {
      flashSaleId,
      availableQuantity,
      soldQuantity,
    });
  }
}
