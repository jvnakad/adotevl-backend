import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { MarketingHistoryEvent, MarketingHistoryType } from './entities/marketing-history-event.entity';
import { User } from '../user/user.entity';
import { PaginationDto } from '../common/pagination.dto';

export interface MarketingListRef {
  id: string;
  name: string;
}

export interface RecordMarketingEventParams {
  organizationId: string;
  type: MarketingHistoryType;
  card: { id: string; title: string };
  /** Fila de origem (CARD_MOVIDO, CARD_ARQUIVADO) */
  fromList?: MarketingListRef | null;
  /** Fila de destino (CARD_MOVIDO) ou inicial (CARD_CRIADO, CARD_RESTAURADO) */
  toList?: MarketingListRef | null;
  description: string;
  metadata?: Record<string, any> | null;
  /** Versão do card produzida pelo evento (eventos que alteram campos do card) */
  version?: number | null;
  userId: string;
  userName: string;
}

export type FieldChange = { field: string; label: string; before: any; after: any };

@Injectable()
export class MarketingHistoryService {
  constructor(
    @InjectRepository(MarketingHistoryEvent)
    private readonly historyRepository: Repository<MarketingHistoryEvent>,
  ) {}

  /** Nome do usuário no momento da ação (snapshot do histórico e de created_by_name). */
  async resolveUserName(manager: EntityManager, userId: string) {
    const user = await manager.findOne(User, { where: { id: userId }, select: { id: true, fullName: true } });
    return user?.fullName ?? 'Usuário removido';
  }

  /** Só insert, sempre dentro da transação da ação: se o evento falhar, a ação também. */
  async record(manager: EntityManager, params: RecordMarketingEventParams) {
    await manager.getRepository(MarketingHistoryEvent).insert({
      organizationId: params.organizationId,
      type: params.type,
      cardId: params.card.id,
      cardTitle: params.card.title,
      fromListId: params.fromList?.id ?? null,
      fromListName: params.fromList?.name ?? null,
      toListId: params.toList?.id ?? null,
      toListName: params.toList?.name ?? null,
      description: params.description,
      metadata: params.metadata ?? null,
      version: params.version ?? null,
      userId: params.userId,
      userName: params.userName,
    });
  }

  /** Linha do tempo do card, mais recente primeiro. O chamador já conferiu que o card é da organização. */
  async findByCard(cardId: string, organizationId: string, query: PaginationDto) {
    const { page = 1, limit = 10 } = query;
    const [events, total] = await this.historyRepository.findAndCount({
      where: { cardId, organizationId },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data: events.map((event) => this.toResponse(event)), total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  toResponse(event: MarketingHistoryEvent) {
    return {
      id: event.id,
      type: event.type,
      cardId: event.cardId,
      cardTitle: event.cardTitle,
      fromList: event.fromListId ? { id: event.fromListId, name: event.fromListName } : null,
      toList: event.toListId ? { id: event.toListId, name: event.toListName } : null,
      description: event.description,
      metadata: event.metadata ?? null,
      userId: event.userId,
      userName: event.userName,
      createdAt: event.createdAt,
    };
  }
}
