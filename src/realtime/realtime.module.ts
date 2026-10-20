import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ClientIdMiddleware } from '../common/request-context';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';

// Global: qualquer módulo injeta RealtimeService (emit / registerRoomType) sem importar este
@Global()
@Module({
  providers: [RealtimeService, RealtimeGateway],
  exports: [RealtimeService],
})
export class RealtimeModule implements NestModule {
  // X-Client-Id de toda requisição: ecoado nos eventos para o cliente ignorar o próprio eco
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ClientIdMiddleware).forRoutes('*');
  }
}
