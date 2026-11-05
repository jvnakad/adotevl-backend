import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AccessLevel, hasLevel, Screen } from '../access/access';
import { AccessService } from '../access/access.service';
import { RealtimeService } from '../realtime/realtime.service';
import { currentClientId } from '../common/request-context';

export const MARKETING_BOARD_ROOM = 'marketing-board';
export const marketingBoardRoom = (organizationId: string) => `${MARKETING_BOARD_ROOM}:${organizationId}`;

/** Eventos emitidos na room `marketing-board:<orgId>` (C11). Contrato em docs/api/marketing.md, seção de websocket. */
export const MARKETING_EVENTS = {
  CARD_CREATED: 'marketing.card.created',
  CARD_UPDATED: 'marketing.card.updated',
  CARD_MOVED: 'marketing.card.moved',
  CARD_ARCHIVED: 'marketing.card.archived',
  CARD_RESTORED: 'marketing.card.restored',
  TASK_CHANGED: 'marketing.task.changed',
  ATTACHMENT_CHANGED: 'marketing.attachment.changed',
  COMMENT_CHANGED: 'marketing.comment.changed',
  LIST_CHANGED: 'marketing.list.changed',
  LABEL_CHANGED: 'marketing.label.changed',
} as const;

/**
 * Publica o que mudou no quadro para quem está na room da organização e tem Marketing Visualizar (checado no join e a cada emissão).
 * Payload leve: ids, campos alterados, `updatedAt` do card (versão, para detectar conflito) e `actor` (para ignorar o próprio eco).
 * Sem títulos, descrições ou textos: o front busca os dados pela API, que aplica as permissões.
 * Sempre depois do commit da transação; falha de tempo real nunca falha a ação.
 */
@Injectable()
export class MarketingRealtimeService implements OnModuleInit {
  private readonly logger = new Logger(MarketingRealtimeService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly realtime: RealtimeService,
    private readonly access: AccessService,
  ) {}

  onModuleInit() {
    this.realtime.registerRoomType(MARKETING_BOARD_ROOM, async (user, organizationId) => {
      if (organizationId !== user.organizationId) return false;
      const access = await this.access.forUser(user.id);
      return !!access && hasLevel(access.permissions[Screen.MARKETING], AccessLevel.VIEW);
    });
  }

  /** Evento sem card (filas, etiquetas). */
  async publish(organizationId: string, actorId: string, event: string, payload: Record<string, unknown>) {
    try {
      await this.realtime.emit(marketingBoardRoom(organizationId), event, { ...payload, actor: await this.actor(actorId), clientId: currentClientId(), at: new Date().toISOString() });
    } catch (error) {
      this.logger.warn(`Falha ao publicar ${event}: ${(error as Error).message}`);
    }
  }

  /** Evento de um card: acrescenta fila, posição e `updatedAt` atuais do card. */
  async publishCard(organizationId: string, actorId: string, event: string, cardId: string, extra: Record<string, unknown> = {}) {
    try {
      const [card] = await this.dataSource.query(`SELECT list_id AS "listId", position, version, updated_at AS "updatedAt" FROM marketing_cards WHERE id = $1`, [cardId]);
      await this.publish(organizationId, actorId, event, { cardId, listId: card?.listId ?? null, position: card?.position ?? null, version: card?.version ?? null, updatedAt: card?.updatedAt ?? null, ...extra });
    } catch (error) {
      this.logger.warn(`Falha ao publicar ${event}: ${(error as Error).message}`);
    }
  }

  private async actor(userId: string) {
    const [user] = await this.dataSource.query(`SELECT full_name AS name FROM users WHERE id = $1`, [userId]);
    return { id: userId, name: user?.name ?? 'Usuário removido' };
  }
}
