import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { RealtimeService, RealtimeUser } from './realtime.service';
import { corsOrigin } from '../common/cors';

/** Tempo para o cliente renovar o token depois de `auth:expired` antes de ser desconectado. */
export const TOKEN_REFRESH_GRACE_MS = 15_000;
const MAX_TIMER_MS = 2 ** 31 - 1;

interface SocketData {
  user: RealtimeUser;
  /** exp do JWT em segundos */
  exp: number;
  expiryTimer?: NodeJS.Timeout;
  graceTimer?: NodeJS.Timeout;
}

/**
 * Gateway Socket.IO (mesma porta do HTTP, caminho `/socket.io`).
 * Handshake: `io(url, { auth: { token: '<jwt>' } })` (ou header Authorization: Bearer). Sem token, inválido ou expirado = `connect_error`.
 * CORS igual ao HTTP: só as origens de CORS_ORIGINS (`common/cors.ts`).
 */
@WebSocketGateway({ cors: { origin: corsOrigin } })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly realtime: RealtimeService,
  ) {}

  afterInit(server: Server) {
    this.realtime.attach(server);
    server.use(async (socket, next) => {
      try {
        const claims = await this.authenticate(this.tokenOf(socket));
        socket.data = { user: claims.user, exp: claims.exp } as SocketData;
        next();
      } catch (error) {
        next(error as Error);
      }
    });
  }

  handleConnection(socket: Socket) {
    const data = socket.data as SocketData;
    socket.join([RealtimeService.orgRoom(data.user.organizationId), RealtimeService.userRoom(data.user.id)]);
    this.scheduleExpiry(socket);
    socket.emit('realtime:ready', { userId: data.user.id, organizationId: data.user.organizationId });
  }

  handleDisconnect(socket: Socket) {
    this.clearTimers(socket.data as SocketData);
  }

  /** Entra numa room de recurso. Ack: `{ ok: true }` ou `{ ok: false, error }`. Permissão lida do banco na hora. */
  @SubscribeMessage('room:join')
  async join(@MessageBody() body: { room?: string }, @ConnectedSocket() socket: Socket) {
    const room = typeof body?.room === 'string' ? body.room : '';
    if (!(await this.realtime.canJoin((socket.data as SocketData).user, room))) return { ok: false, error: 'FORBIDDEN', room };
    await socket.join(room);
    return { ok: true, room };
  }

  @SubscribeMessage('room:leave')
  async leave(@MessageBody() body: { room?: string }, @ConnectedSocket() socket: Socket) {
    const room = typeof body?.room === 'string' ? body.room : '';
    const data = socket.data as SocketData;
    // As rooms automáticas (org e user) não saem
    if (room !== RealtimeService.orgRoom(data.user.organizationId) && room !== RealtimeService.userRoom(data.user.id)) await socket.leave(room);
    return { ok: true, room };
  }

  /** Renova o token da conexão (depois de `auth:expired`). Precisa ser do mesmo usuário. */
  @SubscribeMessage('auth:refresh')
  async refresh(@MessageBody() body: { token?: string }, @ConnectedSocket() socket: Socket) {
    const data = socket.data as SocketData;
    try {
      const claims = await this.authenticate(typeof body?.token === 'string' ? body.token : undefined);
      if (claims.user.id !== data.user.id) return { ok: false, error: 'UNAUTHORIZED' };
      data.exp = claims.exp;
      data.user = claims.user;
      this.scheduleExpiry(socket);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  private tokenOf(socket: Socket): string | undefined {
    const fromAuth = socket.handshake.auth?.token;
    if (typeof fromAuth === 'string' && fromAuth) return fromAuth;
    const header = socket.handshake.headers?.authorization;
    return typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : undefined;
  }

  private async authenticate(token: string | undefined): Promise<{ user: RealtimeUser; exp: number }> {
    if (!token) throw new Error('UNAUTHORIZED');
    try {
      const claims = await this.jwt.verifyAsync<{ sub: string; organizationId: string; exp: number }>(token);
      if (!claims.sub || !claims.organizationId) throw new Error('UNAUTHORIZED');
      return { user: { id: claims.sub, organizationId: claims.organizationId }, exp: claims.exp };
    } catch (error) {
      throw new Error((error as Error).name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'UNAUTHORIZED');
    }
  }

  /** No vencimento do JWT: avisa (`auth:expired`) e dá uma janela para `auth:refresh`; sem renovação, desconecta. */
  private scheduleExpiry(socket: Socket) {
    const data = socket.data as SocketData;
    this.clearTimers(data);
    const wait = Math.min(Math.max(data.exp * 1000 - Date.now(), 0), MAX_TIMER_MS);
    data.expiryTimer = setTimeout(() => {
      socket.emit('auth:expired', { graceMs: TOKEN_REFRESH_GRACE_MS });
      data.graceTimer = setTimeout(() => socket.disconnect(true), TOKEN_REFRESH_GRACE_MS);
      data.graceTimer.unref?.();
    }, wait);
    data.expiryTimer.unref?.();
  }

  private clearTimers(data: SocketData) {
    if (data.expiryTimer) clearTimeout(data.expiryTimer);
    if (data.graceTimer) clearTimeout(data.graceTimer);
  }
}
