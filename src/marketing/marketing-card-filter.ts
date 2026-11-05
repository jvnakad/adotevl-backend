import { BadRequestException } from '@nestjs/common';
import { toLikeTerm } from '../common/normalize-name';
import { localPeriod } from '../stock/stock-date';
import { CalendarDateField, MarketingCardFilterDto } from './dto/marketing-query.dto';

export type CardFilters = MarketingCardFilterDto & { without?: CalendarDateField };

function assertRange(from: string | undefined, to: string | undefined, message: string) {
  if (from && to && from > to) throw new BadRequestException(message);
}

/**
 * Condições dos filtros (C13) sobre `marketing_cards c`, combinadas com AND. Dentro de memberIds/labelIds/listIds vale
 * qualquer um (OR). Devolve texto começando em " AND ..." (ou vazio) e empilha os valores em `params` ($n pela posição).
 * Datas 'YYYY-MM-DD' são dias de Brasília e inclusivas; createdFrom/To comparam o instante de criação nesse dia.
 */
export function buildCardFilter(filters: CardFilters, params: unknown[]): string {
  const clauses: string[] = [];
  const bind = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  assertRange(filters.createdFrom, filters.createdTo, 'A data inicial de criação não pode ser maior que a final.');
  assertRange(filters.dueFrom, filters.dueTo, 'O prazo inicial não pode ser maior que o final.');
  assertRange(filters.publishFrom, filters.publishTo, 'A publicação inicial não pode ser maior que a final.');

  const term = toLikeTerm(filters.q ?? '');
  if (term) clauses.push(`c.title_normalized LIKE ${bind(term)}`);
  if (filters.listIds?.length) clauses.push(`c.list_id = ANY(${bind(filters.listIds)}::uuid[])`);
  if (filters.memberIds?.length) {
    clauses.push(`EXISTS (SELECT 1 FROM marketing_card_members fm WHERE fm.card_id = c.id AND fm.user_id = ANY(${bind(filters.memberIds)}::uuid[]))`);
  }
  if (filters.labelIds?.length) {
    clauses.push(
      `EXISTS (SELECT 1 FROM marketing_card_labels fl JOIN marketing_labels ml ON ml.id = fl.label_id AND ml.is_active = true ` +
        `WHERE fl.card_id = c.id AND fl.label_id = ANY(${bind(filters.labelIds)}::uuid[]))`,
    );
  }

  const created = localPeriod(filters.createdFrom, filters.createdTo);
  if (created.start) clauses.push(`c.created_at >= ${bind(created.start)}`);
  if (created.endExclusive) clauses.push(`c.created_at < ${bind(created.endExclusive)}`);
  if (filters.dueFrom) clauses.push(`c.due_date >= ${bind(filters.dueFrom)}::date`);
  if (filters.dueTo) clauses.push(`c.due_date <= ${bind(filters.dueTo)}::date`);
  if (filters.publishFrom) clauses.push(`c.publish_date >= ${bind(filters.publishFrom)}::date`);
  if (filters.publishTo) clauses.push(`c.publish_date <= ${bind(filters.publishTo)}::date`);
  if (filters.without) clauses.push(`c.${filters.without === CalendarDateField.PUBLISH ? 'publish_date' : 'due_date'} IS NULL`);

  return clauses.map((clause) => ` AND ${clause}`).join('');
}
