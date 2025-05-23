import { Module } from '@nestjs/common';
import { WebSocketGateway } from './websocket.gateway';
import { WebSocketService } from './websocket.service';
import { JwtModule } from 'src/jwt/jwt.modulte';
import { WebSocketController } from './websocket.controller';
import { RedisModule } from '../redis/redis.module';
import { ClientsModule } from '../clients/clients.module';

@Module({
  imports: [JwtModule, RedisModule, ClientsModule],
  controllers: [WebSocketController],
  providers: [WebSocketGateway, WebSocketService],
  exports: [WebSocketService],
})
export class WebSocketModule {}
