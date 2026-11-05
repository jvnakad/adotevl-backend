import { ConflictException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { MARKETING_POSITION_GAP } from './entities/marketing-list.entity';

const INT_MAX = 2147483647;

/** Tabelas com coluna `position` esparsa (filas, cards e subtarefas). */
export type PositionTable = 'marketing_lists' | 'marketing_cards' | 'marketing_card_tasks';

export type PositionPlan = { position: number } | { renumber: true };

/**
 * Calcula a posição para inserir no índice `index` (base 0) de uma lista já ordenada, SEM o item que está sendo movido.
 * Ponto médio entre os vizinhos; sem espaço (diferença < 2) ou estouro do inteiro, pede renumeração (docs/db/marketing.md, seção 5).
 */
export function planPosition(siblings: number[], index: number): PositionPlan {
  const at = Math.min(Math.max(index, 0), siblings.length);
  const prev = at > 0 ? siblings[at - 1] : 0;
  const next = at < siblings.length ? siblings[at] : null;
  if (next === null) {
    const position = prev + MARKETING_POSITION_GAP;
    return position > INT_MAX ? { renumber: true } : { position };
  }
  return next - prev >= 2 ? { position: Math.floor((prev + next) / 2) } : { renumber: true };
}

/** Ordem final dos ids com o item movido (ou novo) no índice pedido. */
export function orderWith(siblingIds: string[], movedId: string | null, index: number): string[] {
  const at = Math.min(Math.max(index, 0), siblingIds.length);
  const order = [...siblingIds];
  if (movedId) order.splice(at, 0, movedId);
  return order;
}

/**
 * Posição final do item movido (ou novo, `movedId` null) no índice pedido entre os `siblings` ativos do escopo, já ordenados
 * e sem o item movido. Quando não há espaço, renumera o escopo inteiro (passo 1024) na mesma transação. O chamador grava a
 * posição devolvida no item (na renumeração o item movido já fica gravado, mas regravar o mesmo valor é inofensivo).
 */
export async function resolvePosition(
  manager: EntityManager,
  table: PositionTable,
  siblings: { id: string; position: number }[],
  movedId: string | null,
  index: number,
): Promise<{ position: number; renumbered: boolean }> {
  const plan = planPosition(
    siblings.map((sibling) => sibling.position),
    index,
  );
  if ('position' in plan) return { position: plan.position, renumbered: false };

  const at = Math.min(Math.max(index, 0), siblings.length);
  const ids = siblings.map((sibling) => sibling.id);
  const order = orderWith(ids, movedId, at);
  if (order.length) {
    const values = order.map((_, i) => `($${i * 2 + 1}::uuid, $${i * 2 + 2}::int)`).join(', ');
    const params = order.flatMap((id, i) => [id, (i + 1) * MARKETING_POSITION_GAP]);
    // `table` vem só da união PositionTable (nunca de input)
    await manager.query(`UPDATE ${table} AS t SET position = v.pos FROM (VALUES ${values}) AS v(id, pos) WHERE t.id = v.id`, params);
  }
  return { position: (at + 1) * MARKETING_POSITION_GAP, renumbered: true };
}

/**
 * Índice de destino a partir dos vizinhos visíveis que o cliente conhece (com filtro/paginação ele não conhece a fila inteira).
 * `siblingIds` = cards ativos da fila de destino, sem o movido, na ordem real.
 * - só `afterCardId`: logo depois dele; só `beforeCardId`: logo antes dele;
 * - os dois: logo depois de `afterCardId` (entre os dois; cards ocultos entre eles ficam depois do movido) e exige a ordem after -> before;
 * - nenhum: fim da fila.
 * Vizinho que não está (mais) na fila de destino, ou fora da ordem esperada, é 409: o cliente desfaz o movimento otimista.
 */
export function indexFromNeighbours(siblingIds: string[], afterCardId: string | null, beforeCardId: string | null): number {
  const find = (id: string) => {
    const at = siblingIds.indexOf(id);
    if (at < 0) throw new ConflictException('O card vizinho não está mais na fila de destino. Atualize o quadro.');
    return at;
  };
  if (afterCardId && beforeCardId) {
    const after = find(afterCardId);
    if (find(beforeCardId) <= after) throw new ConflictException('Os cards vizinhos não estão mais na ordem esperada. Atualize o quadro.');
    return after + 1;
  }
  if (afterCardId) return find(afterCardId) + 1;
  if (beforeCardId) return find(beforeCardId);
  return siblingIds.length;
}
