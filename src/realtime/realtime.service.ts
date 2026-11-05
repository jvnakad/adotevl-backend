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
 * - `family:<fid>`: automática quando o access tem `fid`; o cliente não entra nem sai (só o `auth:refresh` troca). Cai com `disconnectFamily`.
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

  /**
   * Derruba todos os sockets do usuário (troca de senha, desativação, troca de equipe): o handshake só vale na conexão.
   * Quem ainda tem direito reconecta e passa pelas checagens de novo. Nunca lança.
   */
  async disconnectUser(userId: string): Promise<void> {
    if (!this.server || !userId) return;
    try {
      this.server.in(RealtimeService.userRoom(userId)).disconnectSockets(true);
    } catch (error) {
      this.logger.warn(`Falha ao desconectar os sockets do usuário: ${(error as Error).message}`);
    }
  }

  /**
   * Derruba os sockets de uma família de refresh revogada (logout, reuso, recusa, teto, limite de 10). Busca na room `family:<fid>` (que o
   * cliente não consegue deixar: room:leave a ignora, SEC-BUG-01) e confere `socket.data.fid` antes de desconectar. Nunca lança.
   */
  async disconnectFamily(familyId: string): Promise<void> {
    if (!this.server || !familyId) return;
    try {
      // Duas defesas: só a room da família (sem varrer todos os sockets) e, dentro dela, o socket.data.fid confere antes de derrubar
      const sockets = await this.server.in(RealtimeService.familyRoom(familyId)).fetchSockets();
      for (const socket of sockets) if (socket.data?.fid === familyId) socket.disconnect(true);
    } catch (error) {
      this.logger.warn(`Falha ao desconectar os sockets da família: ${(error as Error).message}`);
    }
  }

  registerRoomType(prefix: string, authorizer: RoomAuthorizer) {
    this.authorizers.set(prefix, authorizer);
  }

  static orgRoom = (organizationId: string) => `org:${organizationId}`;
  static userRoom = (userId: string) => `user:${userId}`;
  static familyRoom = (familyId: string) => `family:${familyId}`;

  /** O usuário pode estar nesta room agora? Permissão lida na hora (revogação vale na próxima entrada ou emissão). */
  async canJoin(user: RealtimeUser, room: string): Promise<boolean> {
    const separator = room.indexOf(':');
    if (separator <= 0) return false;
    const prefix = room.slice(0, separator);
    const id = room.slice(separator + 1);
    if (!id) return false;
    if (prefix === 'org') return id === user.organizationId;
    if (prefix === 'user') return id === user.id;
    // family: é automática, vem do fid do access; ninguém entra por room:join
    if (prefix === 'family') return false;
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
