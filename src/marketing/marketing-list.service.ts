import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { DEFAULT_MARKETING_LISTS, MARKETING_POSITION_GAP, MarketingList } from './entities/marketing-list.entity';
import { MarketingCard } from './entities/marketing-card.entity';
import { CreateMarketingListDto, UpdateMarketingListDto } from './dto/marketing-list.dto';
import { normalizeName } from '../common/normalize-name';
import { resolvePosition } from './marketing-position';
import { toDuplicateNameError } from './marketing-errors';
import { MarketingRealtimeService, MARKETING_EVENTS } from './marketing-realtime.service';

/** Limite de filas ativas por organização (design). */
export const MAX_ACTIVE_LISTS = 15;
const NOT_FOUND_MESSAGE = 'Fila não encontrada.';
const DUPLICATE_MESSAGE = 'Já existe uma fila com esse nome.';

@Injectable()
export class MarketingListService implements OnModuleInit {
  private readonly logger = new Logger(MarketingListService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly rt: MarketingRealtimeService,
  ) {}

  /** Seed das 7 filas padrão em toda organização que ainda não tem nenhuma fila (ativa ou não). */
  async onModuleInit() {
    try {
      const organizations: { id: string }[] = await this.dataSource.query('SELECT id FROM organizations');
      for (const { id } of organizations) await this.ensureDefaultLists(id);
    } catch (error) {
      // O boot não pode cair por causa do seed; a leitura do quadro tenta de novo
      this.logger.error(`Falha ao criar as filas padrão do Marketing: ${(error as Error).message}`);
    }
  }

  /**
   * Cria as filas padrão só se a organização não tem NENHUMA linha em marketing_lists: quem excluiu filas não as recebe de volta.
   * Duas instâncias subindo juntas: o índice único de nome barra a segunda (23505, ignorado).
   */
  async ensureDefaultLists(organizationId: string) {
    const [{ count }] = await this.dataSource.query('SELECT count(*)::int AS count FROM marketing_lists WHERE organization_id = $1', [organizationId]);
    if (count > 0) return;
    try {
      await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(MarketingList);
        await repository.insert(
          DEFAULT_MARKETING_LISTS.map((list, i) => ({
            organizationId,
            name: list.name,
            nameNormalized: normalizeName(list.name),
            color: list.color,
            position: (i + 1) * MARKETING_POSITION_GAP,
            isFinal: list.isFinal,
            createdBy: null,
            updatedBy: null,
          })),
        );
      });
    } catch (error) {
      if ((error as { driverError?: { code?: string } })?.driverError?.code !== '23505') throw error;
    }
  }

  /** Filas ativas na ordem do quadro, com a contagem de cards ativos de cada uma. */
  async findAll(organizationId: string) {
    await this.ensureDefaultLists(organizationId);
    const lists = await this.dataSource.getRepository(MarketingList).find({
      where: { organizationId, isActive: true },
      order: { position: 'ASC', createdAt: 'ASC', id: 'ASC' },
    });
    const counts: { list_id: string; total: number }[] = await this.dataSource.query(
      `SELECT list_id, count(*)::int AS total FROM marketing_cards WHERE organization_id = $1 AND is_active = true GROUP BY list_id`,
      [organizationId],
    );
    const byList = new Map(counts.map((row) => [row.list_id, row.total]));
    return lists.map((list) => this.toResponse(list, byList.get(list.id) ?? 0));
  }

  async create(dto: CreateMarketingListDto, userId: string, organizationId: string) {
    try {
      const saved = await this.dataSource.transaction(async (manager) => {
        const active = await this.lockActiveLists(manager, organizationId);
        if (active.length >= MAX_ACTIVE_LISTS) throw new BadRequestException(`O quadro pode ter no máximo ${MAX_ACTIVE_LISTS} filas.`);
        const nameNormalized = normalizeName(dto.name);
        if (active.some((list) => list.nameNormalized === nameNormalized)) throw new ConflictException(DUPLICATE_MESSAGE);

        const { position } = await resolvePosition(manager, 'marketing_lists', active, null, active.length);
        if (dto.isFinal) await manager.update(MarketingList, { organizationId, isFinal: true, isActive: true }, { isFinal: false, updatedBy: userId });
        const repository = manager.getRepository(MarketingList);
        return repository.save(
          repository.create({
            organizationId,
            name: dto.name,
            nameNormalized,
            color: dto.color,
            position,
            isFinal: dto.isFinal ?? false,
            createdBy: userId,
            updatedBy: userId,
          }),
        );
      });
      await this.rt.publish(organizationId, userId, MARKETING_EVENTS.LIST_CHANGED, { listId: saved.id, action: 'created' });
      return this.toResponse(saved, 0);
    } catch (error) {
      throw toDuplicateNameError(error) ?? error;
    }
  }

  async update(id: string, dto: UpdateMarketingListDto, userId: string, organizationId: string) {
    if (dto.name === null || dto.color === null) throw new BadRequestException('Nome e cor da fila são obrigatórios.');
    try {
      const saved = await this.dataSource.transaction(async (manager) => {
        const active = await this.lockActiveLists(manager, organizationId);
        const list = active.find((item) => item.id === id);
        if (!list) throw new NotFoundException(NOT_FOUND_MESSAGE);

        if (dto.name !== undefined && dto.name !== list.name) {
          const nameNormalized = normalizeName(dto.name);
          if (active.some((item) => item.id !== id && item.nameNormalized === nameNormalized)) throw new ConflictException(DUPLICATE_MESSAGE);
          list.name = dto.name;
          list.nameNormalized = nameNormalized;
        }
        if (dto.color !== undefined) list.color = dto.color;
        if (dto.isFinal !== undefined && dto.isFinal !== list.isFinal) {
          // Só uma fila final ativa por organização: marcar tira a marca da anterior
          if (dto.isFinal) await manager.update(MarketingList, { organizationId, isFinal: true, isActive: true }, { isFinal: false, updatedBy: userId });
          list.isFinal = dto.isFinal;
        }
        list.updatedBy = userId;
        return manager.getRepository(MarketingList).save(list);
      });
      await this.rt.publish(organizationId, userId, MARKETING_EVENTS.LIST_CHANGED, { listId: saved.id, action: 'updated' });
      return this.toResponse(saved, await this.countCards(saved.id));
    } catch (error) {
      throw toDuplicateNameError(error) ?? error;
    }
  }

  /** Reordena: o item vai para o índice pedido entre as demais filas ativas. */
  async move(id: string, index: number, userId: string, organizationId: string) {
    const result = await this.dataSource.transaction(async (manager) => {
      const active = await this.lockActiveLists(manager, organizationId);
      if (!active.some((item) => item.id === id)) throw new NotFoundException(NOT_FOUND_MESSAGE);
      const siblings = active.filter((item) => item.id !== id);
      const { position, renumbered } = await resolvePosition(manager, 'marketing_lists', siblings, id, index);
      await manager.update(MarketingList, { id }, { position, updatedBy: userId });
      return { id, position, renumbered };
    });
    await this.rt.publish(organizationId, userId, MARKETING_EVENTS.LIST_CHANGED, { listId: id, action: 'moved' });
    return result;
  }

  /** Só fila sem cards ativos (D-04). O lock das filas da organização serializa com criar/mover card para ela. */
  async remove(id: string, userId: string, organizationId: string) {
    await this.dataSource.transaction(async (manager) => {
      const active = await this.lockActiveLists(manager, organizationId);
      if (!active.some((item) => item.id === id)) throw new NotFoundException(NOT_FOUND_MESSAGE);
      const activeCards = await manager.count(MarketingCard, { where: { listId: id, isActive: true } });
      if (activeCards > 0) {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          message: `Esta fila tem ${activeCards} ${activeCards === 1 ? 'card ativo' : 'cards ativos'}. Mova os cards para outra fila antes de excluir.`,
          activeCards,
        });
      }
      await manager.update(MarketingList, { id }, { isActive: false, updatedBy: userId });
    });
    await this.rt.publish(organizationId, userId, MARKETING_EVENTS.LIST_CHANGED, { listId: id, action: 'deleted' });
    return { message: 'Fila excluída com sucesso.' };
  }

  /** Filas ativas da organização travadas em ordem de id (evita deadlock) e devolvidas na ordem do quadro. */
  private async lockActiveLists(manager: EntityManager, organizationId: string): Promise<MarketingList[]> {
    await manager.query(`SELECT id FROM marketing_lists WHERE organization_id = $1 ORDER BY id FOR UPDATE`, [organizationId]);
    return manager.getRepository(MarketingList).find({
      where: { organizationId, isActive: true },
      order: { position: 'ASC', createdAt: 'ASC', id: 'ASC' },
    });
  }

  private countCards(listId: string) {
    return this.dataSource.getRepository(MarketingCard).count({ where: { listId, isActive: true } });
  }

  private toResponse(list: MarketingList, cardCount: number) {
    return { id: list.id, name: list.name, color: list.color, position: list.position, isFinal: list.isFinal, cardCount };
  }
}
