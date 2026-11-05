import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { And, EntityManager, FindOptionsWhere, ILike, LessThan, MoreThanOrEqual, Repository } from 'typeorm';
import { AdoptionHistoryEvent, AdoptionHistoryType } from './adoption-history.entity';
import { AdoptionFormStatus } from '../adoption-form/adoption-form.entity';
import { User } from '../user/user.entity';
import { paginate } from '../common/paginate.helper';
import { FindAdoptionHistoryDto } from './dto/find-adoption-history.dto';

export const PUBLIC_FORM_USER_NAME = 'Formulário público';
// Filtro de período é por dia local (Brasil, sem horário de verão desde 2019)
const LOCAL_UTC_OFFSET = '-03:00';

export interface RecordHistoryParams {
  form: { id: string; organizationId: string; fullName: string };
  type: AdoptionHistoryType;
  description: string;
  fromStatus?: AdoptionFormStatus | null;
  toStatus?: AdoptionFormStatus | null;
  metadata?: Record<string, any> | null;
  userId?: string | null;
  // Já resolvido por quem grava vários eventos de uma vez (evita buscar o usuário de novo)
  userName?: string;
}

@Injectable()
export class AdoptionHistoryService {
  constructor(
    @InjectRepository(AdoptionHistoryEvent)
    private readonly historyRepository: Repository<AdoptionHistoryEvent>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async resolveUserName(userId?: string | null) {
    if (!userId) return PUBLIC_FORM_USER_NAME;
    const user = await this.userRepository.findOne({ where: { id: userId }, select: { id: true, fullName: true } });
    return user?.fullName ?? 'Usuário removido';
  }

  // Aceita o EntityManager da transação para o evento ser gravado junto com a alteração
  async record(params: RecordHistoryParams, manager?: EntityManager) {
    const [event] = await this.recordMany([params], manager);
    return event;
  }

  async recordMany(events: RecordHistoryParams[], manager?: EntityManager) {
    if (!events.length) return [];
    const repository = manager ? manager.getRepository(AdoptionHistoryEvent) : this.historyRepository;
    const names = new Map<string, string>();
    const rows: Partial<AdoptionHistoryEvent>[] = [];

    for (const params of events) {
      const key = params.userId ?? '';
      if (params.userName) names.set(key, params.userName);
      if (!names.has(key)) names.set(key, await this.resolveUserName(params.userId));

      rows.push({
        adoptionFormId: params.form.id,
        organizationId: params.form.organizationId,
        adopterName: params.form.fullName,
        type: params.type,
        description: params.description,
        fromStatus: params.fromStatus ?? null,
        toStatus: params.toStatus ?? null,
        metadata: params.metadata ?? null,
        userId: params.userId ?? null,
        userName: names.get(key),
        createdBy: params.userId ?? null,
      });
    }

    const saved = await repository.save(repository.create(rows));
    return saved.map((event) => this.toResponse(event));
  }

  async findByForm(adoptionFormId: string, organizationId: string) {
    const events = await this.historyRepository.find({
      where: { adoptionFormId, organizationId, isActive: true },
      order: { createdAt: 'DESC' },
    });
    return events.map((event) => this.toResponse(event));
  }

  async findAll(query: FindAdoptionHistoryDto, organizationId: string) {
    const where: FindOptionsWhere<AdoptionHistoryEvent> = { organizationId, isActive: true };
    if (query.type) where.type = query.type;
    if (query.adoptionFormId) where.adoptionFormId = query.adoptionFormId;
    const search = query.search?.trim();
    if (search) where.adopterName = ILike(`%${search}%`);

    const from = query.from ? this.startOfLocalDay(query.from) : null;
    const to = query.to ? this.startOfLocalDay(query.to, 1) : null;
    if (from && to) where.createdAt = And(MoreThanOrEqual(from), LessThan(to));
    else if (from) where.createdAt = MoreThanOrEqual(from);
    else if (to) where.createdAt = LessThan(to);

    const result = await paginate(this.historyRepository, { page: query.page, limit: query.limit }, where, undefined, { createdAt: 'DESC' });
    return { ...result, data: result.data.map((event) => this.toResponse(event)) };
  }

  // Formato do contrato da API (sem colunas de auditoria internas)
  toResponse(event: AdoptionHistoryEvent) {
    return {
      id: event.id,
      adoptionFormId: event.adoptionFormId,
      adopterName: event.adopterName,
      type: event.type,
      fromStatus: event.fromStatus ?? null,
      toStatus: event.toStatus ?? null,
      description: event.description,
      metadata: event.metadata ?? null,
      userId: event.userId ?? null,
      userName: event.userName,
      createdAt: event.createdAt,
    };
  }

  private startOfLocalDay(date: string, plusDays = 0) {
    const start = new Date(`${date}T00:00:00${LOCAL_UTC_OFFSET}`);
    start.setUTCDate(start.getUTCDate() + plusDays);
    return start;
  }
}
