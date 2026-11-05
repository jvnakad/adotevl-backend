import { ConflictException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { MarketingCard } from './entities/marketing-card.entity';

export const CARD_NOT_FOUND = 'Card não encontrado.';
export const CARD_ARCHIVED = 'Este card está arquivado. Peça a um administrador para restaurá-lo.';

/**
 * Card da organização. Com `lock`, trava a linha (FOR UPDATE): toda alteração do card, das subtarefas e das posições passa
 * por aqui primeiro e só depois trava filas, então a ordem de locks é sempre card -> filas (sem deadlock).
 * `mutation` recusa card arquivado; leitura aceita.
 */
export async function requireCard(manager: EntityManager, id: string, organizationId: string, options: { lock?: boolean; mutation?: boolean } = {}) {
  const card = await manager.findOne(MarketingCard, {
    where: { id, organizationId },
    ...(options.lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
  });
  if (!card) throw new NotFoundException(CARD_NOT_FOUND);
  if (options.mutation && !card.isActive) throw new ConflictException({ statusCode: 409, error: 'Conflict', code: 'card_archived', message: CARD_ARCHIVED });
  return card;
}
