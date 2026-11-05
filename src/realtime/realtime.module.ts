import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ClientIdMiddleware } from '../common/request-context';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';
import { ScreenRealtimeService } from './screen-realtime.service';

// Global: qualquer módulo injeta RealtimeService (emit / registerRoomType) e ScreenRealtimeService (aviso por tela) sem importar este
@Global()
@Module({
  providers: [RealtimeService, RealtimeGateway, ScreenRealtimeService],
  exports: [RealtimeService, ScreenRealtimeService],
})
export class RealtimeModule implements NestModule {
  // X-Client-Id de toda requisição: ecoado nos eventos para o cliente ignorar o próprio eco
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ClientIdMiddleware).forRoutes('*');
  }
}
