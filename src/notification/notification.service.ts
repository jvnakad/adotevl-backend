import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Notification } from './notification.entity';
import { DEFAULT_NOTIFICATIONS_LIMIT, FindNotificationsDto } from './dto/find-notifications.dto';
import { RealtimeService } from '../realtime/realtime.service';
import { currentClientId } from '../common/request-context';

export interface NotifyInput {
  userId: string;
  organizationId: string;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  metadata?: Record<string, any> | null;
}

export const NOTIFICATION_CREATED_EVENT = 'notification.created';
/** Sincroniza as outras abas do mesmo usuário quando uma notificação (ou todas) é marcada como lida. */
export const NOTIFICATION_READ_EVENT = 'notification.read';

const TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:?\d{2})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cursor opaco = (created_at exato do banco, id) da última notificação da página. Texto do timestamp preserva os microssegundos. */
export const encodeCursor = (createdAt: string, id: string) => Buffer.from(JSON.stringify([createdAt, id])).toString('base64url');
export function decodeCursor(cursor: string): { createdAt: string; id: string } {
  try {
    const [createdAt, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof createdAt === 'string' && typeof id === 'string' && TIMESTAMP.test(createdAt) && UUID.test(id)) return { createdAt, id };
  } catch {
    // cai no erro abaixo
  }
  throw new BadRequestException('Cursor inválido.');
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly repository: Repository<Notification>,
    private readonly realtime: RealtimeService,
  ) {}

  /** Salva e avisa o dono em tempo real (room `user:<id>`). Falha aqui não pode derrubar a ação que gerou a notificação. */
  async notify(input: NotifyInput): Promise<Notification | null> {
    try {
      const saved = await this.repository.save(
        this.repository.create({
          userId: input.userId,
          organizationId: input.organizationId,
          type: input.type,
          title: input.title.slice(0, 200),
          body: input.body ?? null,
          link: input.link?.slice(0, 500) ?? null,
          metadata: input.metadata ?? null,
        }),
      );
      await this.realtime.emitToUser(saved.userId, NOTIFICATION_CREATED_EVENT, {
        notification: this.toResponse(saved),
        unreadCount: await this.unreadCount(saved.userId),
      });
      return saved;
    } catch (error) {
      this.logger.error(`Falha ao notificar ${input.userId} (${input.type}): ${(error as Error).message}`);
      return null;
    }
  }

  async notifyMany(inputs: NotifyInput[]) {
    for (const input of inputs) await this.notify(input);
  }

  /**
   * Do próprio usuário, mais recentes primeiro, paginação por cursor (estável mesmo chegando notificação nova).
   * `nextCursor` é null na última página. `unreadCount` é sempre o total de não lidas, independente do filtro.
   */
  async findAll(userId: string, query: FindNotificationsDto) {
    const limit = query.limit ?? DEFAULT_NOTIFICATIONS_LIMIT;
    const params: unknown[] = [userId];
    let where = 'user_id = $1';
    if (query.unread) where += ' AND read_at IS NULL';
    if (query.cursor) {
      const cursor = decodeCursor(query.cursor);
      params.push(cursor.createdAt, cursor.id);
      where += ` AND (created_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
    }
    params.push(limit + 1);
    const rows: (Notification & { cursorTs: string })[] = await this.repository.query(
      `SELECT id, type, title, body, link, metadata, read_at AS "readAt", created_at AS "createdAt", created_at::text AS "cursorTs"
         FROM notifications WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT $${params.length}`,
      params,
    );
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((row) => this.toResponse(row)),
      unreadCount: await this.unreadCount(userId),
      nextCursor: rows.length > limit ? encodeCursor(last.cursorTs, last.id) : null,
    };
  }

  unreadCount(userId: string) {
    return this.repository.count({ where: { userId, readAt: IsNull() } });
  }

  /** Idempotente: já lida mantém a data original. Notificação de outro usuário é 404 (não revela que existe). */
  async markRead(id: string, userId: string) {
    const notification = await this.repository.findOne({ where: { id, userId } });
    if (!notification) throw new NotFoundException('Notificação não encontrada.');
    const unreadCount = async () => this.unreadCount(userId);
    // Já lida: idempotente, não grava nem emite notification.read de novo
    if (notification.readAt) return { unreadCount: await unreadCount() };
    notification.readAt = new Date();
    await this.repository.save(notification);
    const count = await unreadCount();
    await this.realtime.emitToUser(userId, NOTIFICATION_READ_EVENT, { ids: [id], all: false, unreadCount: count, clientId: currentClientId() });
    return { unreadCount: count };
  }

  async markAllRead(userId: string) {
    await this.repository.update({ userId, readAt: IsNull() }, { readAt: new Date() });
    await this.realtime.emitToUser(userId, NOTIFICATION_READ_EVENT, { ids: null, all: true, unreadCount: 0, clientId: currentClientId() });
    return { unreadCount: 0 };
  }

  toResponse(notification: Pick<Notification, 'id' | 'type' | 'title' | 'body' | 'link' | 'metadata' | 'readAt' | 'createdAt'>) {
    return {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      link: notification.link,
      metadata: notification.metadata,
      isRead: !!notification.readAt,
      readAt: notification.readAt,
      createdAt: notification.createdAt,
    };
  }
}
