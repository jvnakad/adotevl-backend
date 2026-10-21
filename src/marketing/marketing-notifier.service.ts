import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { NotificationService, NotifyInput } from '../notification/notification.service';
import { MarketingEligibilityService } from './marketing-eligibility.service';

export const MARKETING_NOTIFICATION = {
  MEMBER_ADDED: 'MARKETING_MEMBER_ADDED',
  MENTION: 'MARKETING_MENTION',
  COMMENT: 'MARKETING_COMMENT',
  CARD_MOVED: 'MARKETING_CARD_MOVED',
} as const;

const unique = (ids: string[]) => [...new Set(ids)];

/**
 * Quem recebe o quê num comentário (C12). O autor nunca é notificado e cada pessoa recebe no máximo uma notificação:
 * a de menção vale mais que a de "comentário novo em card que sou membro".
 * - criado: menção para os mencionados; comentário para os membros que não foram mencionados;
 * - editado: só quem passou a ser mencionado agora (`mentionIds` = novas menções); membros não são avisados de novo.
 */
export function planCommentRecipients(params: { actorId: string; mentionIds: string[]; memberIds: string[]; kind: 'created' | 'edited' }) {
  const mention = unique(params.mentionIds).filter((id) => id !== params.actorId);
  if (params.kind === 'edited') return { mention, comment: [] as string[] };
  const comment = unique(params.memberIds).filter((id) => id !== params.actorId && !mention.includes(id));
  return { mention, comment };
}

/** Gatilhos de notificação do Marketing. Sempre depois do commit; falha aqui nunca falha a ação. */
@Injectable()
export class MarketingNotifier {
  private readonly logger = new Logger(MarketingNotifier.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly notifications: NotificationService,
    private readonly eligibility: MarketingEligibilityService,
  ) {}

  /** Adicionado como membro de um card. */
  membersAdded(organizationId: string, cardId: string, userIds: string[], actorId: string) {
    return this.run('membersAdded', async () => {
      const recipients = await this.viewers(organizationId, unique(userIds).filter((id) => id !== actorId));
      if (!recipients.length) return;
      const { card, actorName } = await this.context(cardId, actorId);
      await this.send(recipients, (userId) => ({
        userId,
        organizationId,
        type: MARKETING_NOTIFICATION.MEMBER_ADDED,
        title: `${actorName} adicionou você ao card "${card.title}"`,
        body: 'Você agora acompanha este card.',
        link: `/marketing?card=${cardId}`,
        metadata: { cardId, actorId },
      }));
    });
  }

  /** Comentário novo: menções + membros (sem duplicar). `mentionIds` = menções já filtradas pelo service de comentários. */
  commentAdded(organizationId: string, cardId: string, actorId: string, mentionIds: string[], excerpt: string) {
    return this.run('commentAdded', async () => {
      const members = await this.memberIds(cardId);
      await this.sendComment(organizationId, cardId, actorId, planCommentRecipients({ actorId, mentionIds, memberIds: members, kind: 'created' }), excerpt);
    });
  }

  /** Comentário editado: `newMentionIds` são só os que entraram em `mentions` nesta edição. */
  commentEdited(organizationId: string, cardId: string, actorId: string, newMentionIds: string[], excerpt: string) {
    return this.run('commentEdited', async () => {
      await this.sendComment(organizationId, cardId, actorId, planCommentRecipients({ actorId, mentionIds: newMentionIds, memberIds: [], kind: 'edited' }), excerpt);
    });
  }

  /** Card movido de fila: avisa os membros (menos quem moveu). */
  cardMoved(organizationId: string, cardId: string, actorId: string, fromListId: string, toListId: string) {
    return this.run('cardMoved', async () => {
      const recipients = await this.viewers(organizationId, (await this.memberIds(cardId)).filter((id) => id !== actorId));
      if (!recipients.length) return;
      const { card, actorName } = await this.context(cardId, actorId);
      const lists: { id: string; name: string }[] = await this.dataSource.query(`SELECT id, name FROM marketing_lists WHERE id = ANY($1::uuid[])`, [[fromListId, toListId]]);
      const name = (id: string) => lists.find((list) => list.id === id)?.name ?? '?';
      await this.send(recipients, (userId) => ({
        userId,
        organizationId,
        type: MARKETING_NOTIFICATION.CARD_MOVED,
        title: `${actorName} moveu "${card.title}" de ${name(fromListId)} para ${name(toListId)}`,
        body: `Fila atual: ${name(toListId)}.`,
        link: `/marketing?card=${cardId}`,
        metadata: { cardId, actorId, fromListId, toListId },
      }));
    });
  }

  // ---- internos ----

  private async sendComment(organizationId: string, cardId: string, actorId: string, plan: { mention: string[]; comment: string[] }, excerpt: string) {
    const mention = await this.viewers(organizationId, plan.mention);
    const comment = await this.viewers(organizationId, plan.comment);
    if (!mention.length && !comment.length) return;
    const { card, actorName } = await this.context(cardId, actorId);
    const base = { organizationId, body: excerpt, link: `/marketing?card=${cardId}`, metadata: { cardId, actorId } };
    await this.send(mention, (userId) => ({ ...base, userId, type: MARKETING_NOTIFICATION.MENTION, title: `${actorName} mencionou você em "${card.title}"` }));
    await this.send(comment, (userId) => ({ ...base, userId, type: MARKETING_NOTIFICATION.COMMENT, title: `${actorName} comentou em "${card.title}"` }));
  }

  /** Só quem ainda enxerga o Marketing (não vaza título de card para quem perdeu o acesso). */
  private async viewers(organizationId: string, userIds: string[]) {
    return (await this.eligibility.filterViewers(organizationId, userIds)).map((user) => user.id);
  }

  private async memberIds(cardId: string) {
    const rows: { userId: string }[] = await this.dataSource.query(`SELECT user_id AS "userId" FROM marketing_card_members WHERE card_id = $1`, [cardId]);
    return rows.map((row) => row.userId);
  }

  private async context(cardId: string, actorId: string) {
    const [card] = await this.dataSource.query(`SELECT id, title FROM marketing_cards WHERE id = $1`, [cardId]);
    const [actor] = await this.dataSource.query(`SELECT full_name AS name FROM users WHERE id = $1`, [actorId]);
    return { card: card as { id: string; title: string }, actorName: (actor?.name as string) ?? 'Alguém' };
  }

  private async send(userIds: string[], build: (userId: string) => NotifyInput) {
    await this.notifications.notifyMany(userIds.map(build));
  }

  private async run(name: string, action: () => Promise<void>) {
    try {
      await action();
    } catch (error) {
      this.logger.error(`Falha nas notificações (${name}): ${(error as Error).message}`);
    }
  }
}
