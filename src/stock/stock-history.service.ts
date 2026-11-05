import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { StockHistoryEvent, StockHistoryType } from './stock-history.entity';
import { User } from '../user/user.entity';
import { normalizeName, toLikeTerm } from '../common/normalize-name';
import { FindStockHistoryDto } from './dto/find-stock-history.dto';
import { localPeriod } from './stock-date';

export interface RecordStockEventParams {
  organizationId: string;
  type: StockHistoryType;
  productId?: string | null;
  productTypeId?: string | null;
  subjectName: string;
  previousSubjectName?: string | null;
  description: string;
  metadata?: Record<string, any> | null;
  userId: string;
  userName: string;
}

@Injectable()
export class StockHistoryService {
  constructor(
    @InjectRepository(StockHistoryEvent)
    private readonly historyRepository: Repository<StockHistoryEvent>,
  ) {}

  /** Nome do usuário no momento da ação (snapshot do histórico e de created_by_name). */
  async resolveUserName(manager: EntityManager, userId: string) {
    const user = await manager.findOne(User, { where: { id: userId }, select: { id: true, fullName: true } });
    return user?.fullName ?? 'Usuário removido';
  }

  /** Só insert, sempre dentro da transação da ação: se o evento falhar, a ação também (RN-41). */
  async record(manager: EntityManager, params: RecordStockEventParams) {
    const repository = manager.getRepository(StockHistoryEvent);
    const previous = params.previousSubjectName ?? null;
    await repository.insert({
      organizationId: params.organizationId,
      type: params.type,
      productId: params.productId ?? null,
      productTypeId: params.productTypeId ?? null,
      subjectName: params.subjectName,
      subjectNameNormalized: normalizeName(params.subjectName),
      previousSubjectName: previous,
      previousSubjectNameNormalized: previous === null ? null : normalizeName(previous),
      description: params.description,
      metadata: params.metadata ?? null,
      userId: params.userId,
      userName: params.userName,
    });
  }

  async findAll(query: FindStockHistoryDto, organizationId: string) {
    const { page = 1, limit = 10 } = query;
    const { start, endExclusive } = localPeriod(query.from, query.to);

    const qb = this.historyRepository.createQueryBuilder('e').where('e.organizationId = :organizationId', { organizationId });
    if (query.type) qb.andWhere('e.type = :type', { type: query.type });
    if (query.userId) qb.andWhere('e.userId = :userId', { userId: query.userId });
    if (start) qb.andWhere('e.createdAt >= :start', { start });
    if (endExclusive) qb.andWhere('e.createdAt < :endExclusive', { endExclusive });

    // Busca por qualquer nome que o item já teve: acha os itens com algum evento que combina e traz todos os eventos deles.
    // Evento de produto só tem o nome do produto nas colunas subject_*, então buscar o nome de um tipo não traz PRODUTO_EDITADO (D-29).
    const term = toLikeTerm(query.search ?? '');
    if (term) {
      const matches = (column: 'product_id' | 'product_type_id') =>
        `SELECT m.${column} FROM stock_history_events m WHERE m.organization_id = :organizationId AND m.${column} IS NOT NULL ` +
        `AND (m.subject_name_normalized LIKE :term OR m.previous_subject_name_normalized LIKE :term)`;
      qb.andWhere(`(e.productId IN (${matches('product_id')}) OR e.productTypeId IN (${matches('product_type_id')}))`, { term });
    }

    const [events, total] = await qb
      .orderBy('e.createdAt', 'DESC')
      .addOrderBy('e.id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { data: events.map((event) => this.toResponse(event)), total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /** Usuários com eventos no histórico da organização (inclui removidos, pelo nome gravado): nome mais recente de cada um, A→Z. */
  async findUsers(organizationId: string) {
    const rows: { id: string; name: string }[] = await this.historyRepository.query(
      `SELECT DISTINCT ON (user_id) user_id AS id, user_name AS name
         FROM stock_history_events
        WHERE organization_id = $1
        ORDER BY user_id, created_at DESC, id DESC`,
      [organizationId],
    );
    return rows.sort((a, b) => normalizeName(a.name).localeCompare(normalizeName(b.name)) || a.id.localeCompare(b.id));
  }

  toResponse(event: StockHistoryEvent) {
    return {
      id: event.id,
      type: event.type,
      productId: event.productId,
      productTypeId: event.productTypeId,
      subjectName: event.subjectName,
      previousSubjectName: event.previousSubjectName,
      description: event.description,
      metadata: event.metadata ?? null,
      userId: event.userId,
      userName: event.userName,
      createdAt: event.createdAt,
    };
  }
}
