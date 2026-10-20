import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';

/** Usuário autenticado no handshake (claims do JWT). */
export interface RealtimeUser {
  id: string;
  organizationId: string;
}

/** Decide se o usuário pode estar numa room de recurso (`<prefixo>:<idDoRecurso>`). Consultada no join e a cada emissão. */
export type RoomAuthorizer = (user: RealtimeUser, resourceId: string) => Promise<boolean>;

export const ROOM_ERRORS = { REVOKED: 'room:revoked' } as const;

/**
 * Tempo real genérico (C10). Módulos de negócio registram o tipo de room com a sua regra de permissão
 * (`registerRoomType`) e emitem com `emit(room, event, payload)`. O Marketing é o primeiro consumidor.
 *
 * Rooms:
 * - `org:<organizationId>`: automática na conexão; só da própria organização.
 * - `user:<userId>`: automática; só o próprio usuário.
 * - `<prefixo>:<id>` registrado por um módulo (ex.: `marketing-board:<orgId>`): entra com `room:join`, com checagem de permissão.
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private server: Server | null = null;
  private readonly authorizers = new Map<string, RoomAuthorizer>();

  /** Chamado pelo gateway quando o servidor Socket.IO sobe. */
  attach(server: Server) {
    this.server = server;
  }

  registerRoomType(prefix: string, authorizer: RoomAuthorizer) {
    this.authorizers.set(prefix, authorizer);
  }

  static orgRoom = (organizationId: string) => `org:${organizationId}`;
  static userRoom = (userId: string) => `user:${userId}`;

  /** O usuário pode estar nesta room agora? Permissão lida na hora (revogação vale na próxima entrada ou emissão). */
  async canJoin(user: RealtimeUser, room: string): Promise<boolean> {
    const separator = room.indexOf(':');
    if (separator <= 0) return false;
    const prefix = room.slice(0, separator);
    const id = room.slice(separator + 1);
    if (!id) return false;
    if (prefix === 'org') return id === user.organizationId;
    if (prefix === 'user') return id === user.id;
    const authorizer = this.authorizers.get(prefix);
    if (!authorizer) return false;
    try {
      return await authorizer(user, id);
    } catch (error) {
      this.logger.warn(`Falha ao checar a room ${room}: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Emite para quem está na room E ainda tem permissão: quem perdeu o acesso sai da room, recebe `room:revoked` e não recebe o evento.
   * Nunca lança: tempo real não pode derrubar a ação HTTP que o originou.
   */
  async emit(room: string, event: string, payload: unknown): Promise<void> {
    if (!this.server) return;
    try {
      const sockets = await this.server.in(room).fetchSockets();
      const verdicts = new Map<string, Promise<boolean>>();
      await Promise.all(
        sockets.map(async (socket) => {
          const user = socket.data?.user as RealtimeUser | undefined;
          if (!user) return;
          if (!verdicts.has(user.id)) verdicts.set(user.id, this.canJoin(user, room));
          if (await verdicts.get(user.id)) {
            socket.emit(event, payload);
          } else {
            socket.leave(room);
            socket.emit(ROOM_ERRORS.REVOKED, { room });
          }
        }),
      );
    } catch (error) {
      this.logger.warn(`Falha ao emitir ${event} em ${room}: ${(error as Error).message}`);
    }
  }

  emitToUser(userId: string, event: string, payload: unknown) {
    return this.emit(RealtimeService.userRoom(userId), event, payload);
  }
}
