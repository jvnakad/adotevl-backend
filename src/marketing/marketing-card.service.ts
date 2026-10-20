import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
import { MarketingCard } from './entities/marketing-card.entity';
import { MarketingList } from './entities/marketing-list.entity';
import { MarketingLabel } from './entities/marketing-label.entity';
import { MarketingCardMember } from './entities/marketing-card-member.entity';
import { MarketingCardLabel } from './entities/marketing-card-label.entity';
import { MarketingCardTask } from './entities/marketing-card-task.entity';
import { MarketingCardAttachment } from './entities/marketing-card-attachment.entity';
import { MarketingHistoryType } from './entities/marketing-history-event.entity';
import { FieldChange, MarketingHistoryService } from './marketing-history.service';
import { MarketingEligibilityService } from './marketing-eligibility.service';
import { dueInfo } from './marketing-due';
import { buildCardFilter } from './marketing-card-filter';
import {
  CalendarDateField,
  DEFAULT_CARDS_PER_LIST,
  FindMarketingBoardDto,
  FindMarketingCalendarDto,
  FindMarketingCardsDto,
  FindMarketingListCardsDto,
  MarketingCardSort,
  SortOrder,
} from './dto/marketing-query.dto';
import { MarketingListService } from './marketing-list.service';
import { CreateMarketingCardDto, FindArchivedCardsDto, MoveMarketingCardDto, UpdateMarketingCardDto } from './dto/marketing-card.dto';
import { requireCard } from './marketing-card.helper';
import { indexFromNeighbours, resolvePosition } from './marketing-position';
import { isImageMime, toAttachmentResponse, toTaskResponse } from './marketing-presenter';
import { normalizeName, toLikeTerm } from '../common/normalize-name';
import { todayInBrazil } from '../volunteer-schedule/schedule-time';
import { StorageService } from '../storage/storage.service';

const MAX_CALENDAR_DAYS = 370;
const dayDiff = (from: string, to: string) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);
const TARGET_LIST_NOT_FOUND = 'Fila de destino não encontrada.';

@Injectable()
export class MarketingCardService {
  private readonly logger = new Logger(MarketingCardService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly history: MarketingHistoryService,
    private readonly eligibility: MarketingEligibilityService,
    private readonly lists: MarketingListService,
    private readonly storage: StorageService,
  ) {}

  /** Usuários que podem ser membro, responsável ou mencionado (Editar em Marketing). */
  findMembers(organizationId: string) {
    return this.eligibility.findEligible(organizationId);
  }

  // ---- leitura ----

  /**
   * Quadro: todas as filas ativas na ordem; cada uma com a primeira página dos seus cards (padrão 20, por position), o
   * `total` de cards da fila já filtrados e `hasMore`. Filtros do C13 combinados com AND. As filas aparecem mesmo sem cards.
   */
  async board(query: FindMarketingBoardDto, organizationId: string) {
    await this.lists.ensureDefaultLists(organizationId);
    const lists = await this.activeLists(organizationId);
    const limit = query.limit ?? DEFAULT_CARDS_PER_LIST;
    const params: unknown[] = [organizationId];
    const where = `c.organization_id = $1 AND c.is_active = true${buildCardFilter(query, params)}`;

    const totals: { listId: string; total: number }[] = await this.dataSource.query(
      `SELECT c.list_id AS "listId", count(*)::int AS total FROM marketing_cards c WHERE ${where} GROUP BY c.list_id`,
      params,
    );
    params.push(limit);
    const firsts: { id: string }[] = await this.dataSource.query(
      `SELECT t.id FROM (SELECT c.id, row_number() OVER (PARTITION BY c.list_id ORDER BY c.position, c.created_at, c.id) AS rn
                           FROM marketing_cards c WHERE ${where}) t WHERE t.rn <= $${params.length}`,
      params,
    );
    const cards = this.sortCards(await this.loadCards(firsts.map((row) => row.id)));
    const summaries = await this.summarize(cards, lists);
    const totalBy = new Map(totals.map((row) => [row.listId, row.total]));

    return {
      lists: lists.map((list) => {
        const total = totalBy.get(list.id) ?? 0;
        const listCards = summaries.filter((card) => card.listId === list.id);
        return { id: list.id, name: list.name, color: list.color, position: list.position, isFinal: list.isFinal, total, hasMore: total > listCards.length, cards: listCards };
      }),
    };
  }

  /** "Ver mais" de uma fila: próxima página (offset/limit) dos cards ativos da fila, na ordem do quadro, com os mesmos filtros. */
  async listCards(listId: string, query: FindMarketingListCardsDto, organizationId: string) {
    const list = await this.dataSource.getRepository(MarketingList).findOne({ where: { id: listId, organizationId, isActive: true } });
    if (!list) throw new NotFoundException('Fila não encontrada.');
    const { offset = 0, limit = DEFAULT_CARDS_PER_LIST } = query;

    const params: unknown[] = [organizationId, listId];
    const where = `c.organization_id = $1 AND c.is_active = true AND c.list_id = $2${buildCardFilter(query, params)}`;
    const [{ total }] = await this.dataSource.query(`SELECT count(*)::int AS total FROM marketing_cards c WHERE ${where}`, params);
    params.push(limit, offset);
    const rows: { id: string }[] = await this.dataSource.query(
      `SELECT c.id FROM marketing_cards c WHERE ${where} ORDER BY c.position, c.created_at, c.id LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const data = await this.summarize(this.sortCards(await this.loadCards(rows.map((row) => row.id))), [list]);
    return { data, total, offset, limit, hasMore: offset + data.length < total };
  }

  /**
   * Visão Lista: todos os cards ativos, paginados e filtrados. Ordenação padrão (due asc): atrasados primeiro (mais antigos antes),
   * depois prazo crescente, sem prazo por último. Fila final nunca conta como atrasada (vai no grupo "com prazo").
   */
  async findAll(query: FindMarketingCardsDto, organizationId: string) {
    const { page = 1, limit = 10, sort = MarketingCardSort.DUE } = query;
    const order = query.order ?? (sort === MarketingCardSort.CREATED_AT ? SortOrder.DESC : SortOrder.ASC);
    const dir = order === SortOrder.DESC ? 'DESC' : 'ASC';
    const tie = 'c.created_at ASC, c.id ASC';
    const orderBy: Record<MarketingCardSort, string> = {
      [MarketingCardSort.DUE]:
        order === SortOrder.DESC
          ? `c.due_date DESC NULLS LAST, ${tie}`
          : `CASE WHEN c.due_date IS NULL THEN 2 WHEN c.due_date < $2::date AND l.is_final = false THEN 0 ELSE 1 END, c.due_date ASC, ${tie}`,
      [MarketingCardSort.TITLE]: `c.title_normalized ${dir}, ${tie}`,
      [MarketingCardSort.LIST]: `l.position ${dir}, c.position ASC, ${tie}`,
      [MarketingCardSort.CREATED_AT]: `c.created_at ${dir}, c.id ${dir}`,
    };

    const countParams: unknown[] = [organizationId];
    const countWhere = `c.organization_id = $1 AND c.is_active = true${buildCardFilter(query, countParams)}`;
    const [{ total }] = await this.dataSource.query(`SELECT count(*)::int AS total FROM marketing_cards c WHERE ${countWhere}`, countParams);

    // $2 = hoje (Brasília), usado pela ordenação por prazo; sempre referenciado para o Postgres inferir o tipo
    const params: unknown[] = [organizationId, todayInBrazil()];
    const where = `c.organization_id = $1 AND c.is_active = true AND $2::date IS NOT NULL${buildCardFilter(query, params)}`;
    params.push(limit, (page - 1) * limit);
    const rows: { id: string }[] = await this.dataSource.query(
      `SELECT c.id FROM marketing_cards c JOIN marketing_lists l ON l.id = c.list_id WHERE ${where} ORDER BY ${orderBy[sort]} LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const ids = rows.map((row) => row.id);
    const cards = await this.loadCards(ids);
    const lists = await this.listsById(cards.map((card) => card.listId));
    const byId = new Map((await this.summarize(cards, lists)).map((card) => [card.id, card]));
    return { data: ids.map((id) => byId.get(id)), total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /** Calendário: cards ativos cuja data escolhida cai no intervalo (com os filtros) + quantos cards ativos filtrados não têm essa data. */
  async calendar(query: FindMarketingCalendarDto, organizationId: string) {
    const { from, to } = query;
    const dateField = query.dateField ?? CalendarDateField.DUE;
    if (from > to) throw new BadRequestException('A data inicial não pode ser maior que a final.');
    if (dayDiff(from, to) > MAX_CALENDAR_DAYS) throw new BadRequestException(`O intervalo pode ter no máximo ${MAX_CALENDAR_DAYS} dias.`);
    const column = dateField === CalendarDateField.PUBLISH ? 'publish_date' : 'due_date';

    const params: unknown[] = [organizationId, from, to];
    const filter = buildCardFilter(query, params);
    const rows: { id: string }[] = await this.dataSource.query(
      `SELECT c.id FROM marketing_cards c WHERE c.organization_id = $1 AND c.is_active = true AND c.${column} BETWEEN $2::date AND $3::date${filter}
        ORDER BY c.${column}, c.position, c.id`,
      params,
    );
    const countParams: unknown[] = [organizationId];
    const countFilter = buildCardFilter(query, countParams);
    const [{ total }] = await this.dataSource.query(
      `SELECT count(*)::int AS total FROM marketing_cards c WHERE c.organization_id = $1 AND c.is_active = true AND c.${column} IS NULL${countFilter}`,
      countParams,
    );
    const ids = rows.map((row) => row.id);
    const cards = await this.loadCards(ids);
    const lists = await this.listsById(cards.map((card) => card.listId));
    const byId = new Map((await this.summarize(cards, lists)).map((card) => [card.id, card]));
    return { dateField, from, to, cards: ids.map((id) => byId.get(id)), withoutDateCount: total };
  }

  private async loadCards(ids: string[]) {
    return ids.length ? this.dataSource.getRepository(MarketingCard).find({ where: { id: In(ids) } }) : [];
  }

  /** Ordem do quadro dentro da fila: position, created_at, id. */
  private sortCards(cards: MarketingCard[]) {
    return [...cards].sort((a, b) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1));
  }

  /** Detalhe do card (inclusive arquivado). Comentários e histórico têm rotas próprias. */
  async findOne(id: string, organizationId: string) {
    return this.readDetail(this.dataSource.manager, id, organizationId);
  }

  /** Arquivados da organização, do mais recente. */
  async findArchived(query: FindArchivedCardsDto, organizationId: string) {
    const { page = 1, limit = 10 } = query;
    const qb = this.dataSource
      .getRepository(MarketingCard)
      .createQueryBuilder('c')
      .innerJoinAndSelect('c.list', 'l')
      .where('c.organizationId = :organizationId', { organizationId })
      .andWhere('c.isActive = false');
    const term = toLikeTerm(query.search ?? '');
    if (term) qb.andWhere('c.titleNormalized LIKE :term', { term });
    const [cards, total] = await qb
      .orderBy('c.archivedAt', 'DESC')
      .addOrderBy('c.id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return {
      data: cards.map((card) => ({
        id: card.id,
        title: card.title,
        list: { id: card.list.id, name: card.list.name, color: card.list.color, isActive: card.list.isActive },
        dueDate: card.dueDate ?? null,
        publishDate: card.publishDate ?? null,
        archivedAt: card.archivedAt,
        createdByName: card.createdByName,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ---- escrita ----

  async create(dto: CreateMarketingCardDto, userId: string, organizationId: string) {
    return this.dataSource.transaction(async (manager) => {
      const list = await this.lockList(manager, dto.listId, organizationId);
      const userName = await this.history.resolveUserName(manager, userId);
      const siblings = await this.activeCards(manager, list.id);
      const { position } = await resolvePosition(manager, 'marketing_cards', siblings, null, siblings.length);

      const repository = manager.getRepository(MarketingCard);
      const card = await repository.save(
        repository.create({
          organizationId,
          listId: list.id,
          position,
          title: dto.title,
          titleNormalized: normalizeName(dto.title),
          description: dto.description ?? null,
          dueDate: dto.dueDate ?? null,
          publishDate: dto.publishDate ?? null,
          createdBy: userId,
          createdByName: userName,
        }),
      );
      await this.history.record(manager, {
        organizationId,
        type: MarketingHistoryType.CARD_CRIADO,
        card,
        toList: list,
        description: `Card "${card.title}" criado na fila ${list.name}.`,
        metadata: { values: { title: card.title, dueDate: card.dueDate, publishDate: card.publishDate } },
        userId,
        userName,
      });
      return this.readDetail(manager, card.id, organizationId);
    });
  }

  /** Arrastar: fila + vizinhos visíveis (afterCardId/beforeCardId). O servidor recalcula a position com o estado travado e devolve o resultado final. */
  async move(id: string, dto: MoveMarketingCardDto, userId: string, organizationId: string) {
    return this.dataSource.transaction(async (manager) => {
      const card = await requireCard(manager, id, organizationId, { lock: true, mutation: true });
      const userName = await this.history.resolveUserName(manager, userId);
      if (dto.position === 'last' && (dto.afterCardId || dto.beforeCardId)) {
        throw new BadRequestException('Use position "last" ou os cards vizinhos, não os dois.');
      }
      const moved = await this.moveInTransaction(manager, card, dto.listId, dto.position === 'last' ? null : dto, userId, userName);
      return { id: card.id, fromListId: card.listId, listId: dto.listId, position: moved.position, renumbered: moved.renumbered };
    });
  }

  async update(id: string, dto: UpdateMarketingCardDto, userId: string, organizationId: string) {
    // Obrigatórios que o validador deixa passar como null (@IsOptional): recusa aqui
    if (dto.title === null) throw new BadRequestException('Informe o título do card.');
    if (dto.listId === null) throw new BadRequestException('Escolha a fila.');

    return this.dataSource.transaction(async (manager) => {
      const card = await requireCard(manager, id, organizationId, { lock: true, mutation: true });
      const userName = await this.history.resolveUserName(manager, userId);
      let edited = false;

      // Trocar a fila pelo detalhe = mover para o fim da fila (mesmo evento do arrastar)
      if (dto.listId !== undefined && dto.listId !== card.listId) {
        await this.moveInTransaction(manager, card, dto.listId, null, userId, userName);
      }

      const patch: Partial<MarketingCard> = {};
      const fieldChanges: FieldChange[] = [];
      const dateChanges: FieldChange[] = [];
      if (dto.title !== undefined && dto.title !== card.title) {
        fieldChanges.push({ field: 'title', label: 'Título', before: card.title, after: dto.title });
        patch.title = dto.title;
        patch.titleNormalized = normalizeName(dto.title);
      }
      if (dto.description !== undefined && (dto.description ?? null) !== (card.description ?? null)) {
        fieldChanges.push({ field: 'description', label: 'Descrição', before: card.description ?? null, after: dto.description ?? null });
        patch.description = dto.description ?? null;
      }
      if (dto.dueDate !== undefined && (dto.dueDate ?? null) !== (card.dueDate ?? null)) {
        dateChanges.push({ field: 'dueDate', label: 'Prazo de entrega', before: card.dueDate ?? null, after: dto.dueDate ?? null });
        patch.dueDate = dto.dueDate ?? null;
      }
      if (dto.publishDate !== undefined && (dto.publishDate ?? null) !== (card.publishDate ?? null)) {
        dateChanges.push({ field: 'publishDate', label: 'Data de publicação', before: card.publishDate ?? null, after: dto.publishDate ?? null });
        patch.publishDate = dto.publishDate ?? null;
      }
      const title = patch.title ?? card.title;
      const event = { organizationId, card: { id: card.id, title }, userId, userName };

      if (fieldChanges.length) {
        edited = true;
        await this.history.record(manager, {
          ...event,
          type: MarketingHistoryType.CARD_EDITADO,
          description: `Card "${title}" editado.`,
          metadata: { fields: fieldChanges },
        });
      }
      if (dateChanges.length) {
        edited = true;
        await this.history.record(manager, {
          ...event,
          type: MarketingHistoryType.DATAS_ALTERADAS,
          description: `Datas do card "${title}" alteradas.`,
          metadata: { fields: dateChanges },
        });
      }
      if (dto.memberIds !== undefined) edited = (await this.syncMembers(manager, card, dto.memberIds, event)) || edited;
      if (dto.labelIds !== undefined) edited = (await this.syncLabels(manager, card, dto.labelIds, event)) || edited;

      // Sem mudança real: nada é gravado (mover não conta como edição)
      if (edited) await manager.update(MarketingCard, { id }, { ...patch, updatedBy: userId, updatedByName: userName });
      return this.readDetail(manager, id, organizationId);
    });
  }

  async archive(id: string, userId: string, organizationId: string) {
    await this.dataSource.transaction(async (manager) => {
      const card = await requireCard(manager, id, organizationId, { lock: true, mutation: true });
      const userName = await this.history.resolveUserName(manager, userId);
      const list = await manager.findOneOrFail(MarketingList, { where: { id: card.listId } });
      await manager.update(MarketingCard, { id }, { isActive: false, archivedAt: new Date() });
      await this.history.record(manager, {
        organizationId,
        type: MarketingHistoryType.CARD_ARQUIVADO,
        card,
        fromList: list,
        description: `Card "${card.title}" arquivado.`,
        userId,
        userName,
      });
    });
    return { message: 'Card arquivado com sucesso.' };
  }

  /** Admin: volta ao fim da fila de origem; se ela foi excluída, ao fim da primeira fila ativa. */
  async restore(id: string, userId: string, organizationId: string) {
    return this.dataSource.transaction(async (manager) => {
      const card = await requireCard(manager, id, organizationId, { lock: true });
      if (card.isActive) throw new ConflictException('Este card não está arquivado.');
      const userName = await this.history.resolveUserName(manager, userId);

      const own = await manager.findOneOrFail(MarketingList, { where: { id: card.listId } });
      const [first] = own.isActive
        ? [own]
        : await manager.find(MarketingList, { where: { organizationId, isActive: true }, order: { position: 'ASC', createdAt: 'ASC', id: 'ASC' }, take: 1 });
      if (!first) throw new ConflictException('Não há filas ativas para receber o card. Crie uma fila na Configuração.');

      const target = await this.lockList(manager, first.id, organizationId);
      const siblings = await this.activeCards(manager, target.id);
      const { position } = await resolvePosition(manager, 'marketing_cards', siblings, null, siblings.length);
      await manager.update(MarketingCard, { id }, { isActive: true, archivedAt: null, listId: target.id, position });
      await this.history.record(manager, {
        organizationId,
        type: MarketingHistoryType.CARD_RESTAURADO,
        card,
        toList: target,
        description: `Card "${card.title}" restaurado na fila ${target.name}.`,
        userId,
        userName,
      });
      return this.readDetail(manager, id, organizationId);
    });
  }

  /** Capa manual ("definir como capa"): imagem ativa do próprio card, ou null para remover. Não gera evento. */
  async setCover(id: string, attachmentId: string | null, organizationId: string) {
    return this.dataSource.transaction(async (manager) => {
      await requireCard(manager, id, organizationId, { lock: true, mutation: true });
      if (attachmentId) {
        const attachment = await manager.findOne(MarketingCardAttachment, { where: { id: attachmentId, cardId: id, isActive: true } });
        if (!attachment || !isImageMime(attachment.mimeType)) throw new BadRequestException('A capa precisa ser uma imagem anexada a este card.');
      }
      await manager.update(MarketingCard, { id }, { coverAttachmentId: attachmentId });
      return this.readDetail(manager, id, organizationId);
    });
  }

  // ---- internos ----

  private activeLists(organizationId: string) {
    return this.dataSource.getRepository(MarketingList).find({ where: { organizationId, isActive: true }, order: { position: 'ASC', createdAt: 'ASC', id: 'ASC' } });
  }

  /** Filas (ativas ou não) por id, para resumir cards ativos e arquivados. */
  private async listsById(listIds: string[]) {
    const ids = [...new Set(listIds)];
    const lists = ids.length ? await this.dataSource.getRepository(MarketingList).find({ where: { id: In(ids) } }) : [];
    return lists;
  }

  /** Resumo de card (quadro, lista e calendário): etiquetas, membros, contadores, capa e situação do prazo. Consultas em lote. */
  private async summarize(cards: MarketingCard[], lists: MarketingList[]) {
    if (!cards.length) return [];
    const db = this.dataSource;
    const ids = cards.map((card) => card.id);
    const [members, labels, tasks, attachments, comments, covers] = await Promise.all([
      db.query(
        `SELECT m.card_id AS "cardId", u.id, u.full_name AS name FROM marketing_card_members m JOIN users u ON u.id = m.user_id
          WHERE m.card_id = ANY($1::uuid[]) ORDER BY m.created_at, u.id`,
        [ids],
      ),
      db.query(
        `SELECT cl.card_id AS "cardId", l.id, l.name, l.color FROM marketing_card_labels cl JOIN marketing_labels l ON l.id = cl.label_id AND l.is_active = true
          WHERE cl.card_id = ANY($1::uuid[]) ORDER BY l.name_normalized, l.id`,
        [ids],
      ),
      db.query(
        `SELECT card_id AS "cardId", count(*)::int AS total, count(*) FILTER (WHERE is_done)::int AS done
           FROM marketing_card_tasks WHERE card_id = ANY($1::uuid[]) AND is_active = true GROUP BY card_id`,
        [ids],
      ),
      db.query(`SELECT card_id AS "cardId", count(*)::int AS total FROM marketing_card_attachments WHERE card_id = ANY($1::uuid[]) AND is_active = true GROUP BY card_id`, [ids]),
      db.query(`SELECT card_id AS "cardId", count(*)::int AS total FROM marketing_card_comments WHERE card_id = ANY($1::uuid[]) AND is_active = true GROUP BY card_id`, [ids]),
      this.coverUrls(cards),
    ]);

    const group = <T extends { cardId: string }>(rows: T[]) => {
      const map = new Map<string, T[]>();
      for (const row of rows) map.set(row.cardId, [...(map.get(row.cardId) ?? []), row]);
      return map;
    };
    const membersBy = group<{ cardId: string; id: string; name: string }>(members);
    const labelsBy = group<{ cardId: string; id: string; name: string; color: string }>(labels);
    const count = (rows: { cardId: string; total: number; done?: number }[]) => new Map(rows.map((row) => [row.cardId, row]));
    const tasksBy = count(tasks);
    const attachmentsBy = count(attachments);
    const commentsBy = count(comments);
    const listById = new Map(lists.map((list) => [list.id, list]));
    const today = todayInBrazil();

    return cards.map((card) => {
      const list = listById.get(card.listId);
      return {
        id: card.id,
        listId: card.listId,
        list: list ? { id: list.id, name: list.name, color: list.color, isFinal: list.isFinal } : null,
        position: card.position,
        title: card.title,
        dueDate: card.dueDate ?? null,
        publishDate: card.publishDate ?? null,
        ...dueInfo(card.dueDate ?? null, !!list?.isFinal, today),
        coverUrl: covers[card.id] ?? null,
        members: (membersBy.get(card.id) ?? []).map(({ id, name }) => ({ id, name })),
        labels: (labelsBy.get(card.id) ?? []).map(({ id, name, color }) => ({ id, name, color })),
        tasksTotal: tasksBy.get(card.id)?.total ?? 0,
        tasksDone: tasksBy.get(card.id)?.done ?? 0,
        attachmentsCount: attachmentsBy.get(card.id)?.total ?? 0,
        commentsCount: commentsBy.get(card.id)?.total ?? 0,
      };
    });
  }

  private async activeCards(manager: EntityManager, listId: string, exceptId?: string) {
    const cards = await manager.find(MarketingCard, {
      where: { listId, isActive: true },
      order: { position: 'ASC', createdAt: 'ASC', id: 'ASC' },
      select: { id: true, position: true },
    });
    return exceptId ? cards.filter((card) => card.id !== exceptId) : cards;
  }

  /** Trava a fila (FOR UPDATE) e devolve só se for ativa e da organização. */
  private async lockList(manager: EntityManager, listId: string, organizationId: string) {
    const [row] = await manager.query(`SELECT id FROM marketing_lists WHERE id = $1 AND organization_id = $2 AND is_active = true FOR UPDATE`, [listId, organizationId]);
    if (!row) throw new BadRequestException(TARGET_LIST_NOT_FOUND);
    return manager.findOneOrFail(MarketingList, { where: { id: listId } });
  }

  /**
   * Move o card (já travado) para a fila de destino no índice pedido (null = fim). Trava origem e destino em ordem de id.
   * Gera CARD_MOVIDO só se a fila mudou: reordenar dentro da mesma fila não gera evento.
   */
  private async moveInTransaction(manager: EntityManager, card: MarketingCard, targetListId: string, placement: { afterCardId?: string | null; beforeCardId?: string | null } | null, userId: string, userName: string) {
    const lockIds = [...new Set([card.listId, targetListId])].sort();
    await manager.query(`SELECT id FROM marketing_lists WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`, [lockIds]);
    const target = await manager.findOne(MarketingList, { where: { id: targetListId, organizationId: card.organizationId, isActive: true } });
    if (!target) throw new BadRequestException(TARGET_LIST_NOT_FOUND);
    const from = card.listId === target.id ? target : await manager.findOneOrFail(MarketingList, { where: { id: card.listId } });

    const siblings = await this.activeCards(manager, target.id, card.id);
    const { position, renumbered } = await resolvePosition(
      manager,
      'marketing_cards',
      siblings,
      card.id,
      placement ? indexFromNeighbours(siblings.map((sibling) => sibling.id), placement.afterCardId ?? null, placement.beforeCardId ?? null) : siblings.length,
    );
    await manager.update(MarketingCard, { id: card.id }, { listId: target.id, position });

    if (from.id !== target.id) {
      await this.history.record(manager, {
        organizationId: card.organizationId,
        type: MarketingHistoryType.CARD_MOVIDO,
        card,
        fromList: from,
        toList: target,
        description: `Card "${card.title}" movido de ${from.name} para ${target.name}.`,
        userId,
        userName,
      });
    }
    return { position, renumbered };
  }

  /** Conjunto completo de membros. Quem entra precisa ser elegível; quem já era membro e perdeu o Editar pode ficar (P-06). */
  private async syncMembers(manager: EntityManager, card: MarketingCard, desired: string[], event: EventBase) {
    const current = (await manager.find(MarketingCardMember, { where: { cardId: card.id } })).map((member) => member.userId);
    const toAdd = desired.filter((userId) => !current.includes(userId));
    const toRemove = current.filter((userId) => !desired.includes(userId));
    if (!toAdd.length && !toRemove.length) return false;

    const eligible = await this.eligibility.filterEligible(event.organizationId, toAdd, manager);
    if (eligible.length !== toAdd.length) {
      throw new BadRequestException('Só quem tem permissão de edição no Marketing pode ser membro do card.');
    }
    const removedNames = toRemove.length ? await this.userNames(manager, toRemove) : new Map<string, string>();

    if (toAdd.length) await manager.insert(MarketingCardMember, toAdd.map((userId) => ({ cardId: card.id, userId, createdBy: event.userId })));
    if (toRemove.length) await manager.delete(MarketingCardMember, { cardId: card.id, userId: In(toRemove) });
    for (const user of eligible) {
      await this.history.record(manager, {
        ...event,
        type: MarketingHistoryType.MEMBRO_ADICIONADO,
        description: `${user.name} adicionado(a) ao card.`,
        metadata: { userId: user.id, userName: user.name },
      });
    }
    for (const userId of toRemove) {
      const name = removedNames.get(userId) ?? 'Usuário removido';
      await this.history.record(manager, {
        ...event,
        type: MarketingHistoryType.MEMBRO_REMOVIDO,
        description: `${name} removido(a) do card.`,
        metadata: { userId, userName: name },
      });
    }
    return true;
  }

  private async syncLabels(manager: EntityManager, card: MarketingCard, desired: string[], event: EventBase) {
    const current = (await manager.find(MarketingCardLabel, { where: { cardId: card.id } })).map((link) => link.labelId);
    const toAdd = desired.filter((labelId) => !current.includes(labelId));
    const toRemove = current.filter((labelId) => !desired.includes(labelId));
    if (!toAdd.length && !toRemove.length) return false;

    const added = toAdd.length ? await manager.find(MarketingLabel, { where: { id: In(toAdd), organizationId: event.organizationId, isActive: true } }) : [];
    if (added.length !== toAdd.length) throw new BadRequestException('Etiqueta não encontrada.');
    const removed = toRemove.length ? await manager.find(MarketingLabel, { where: { id: In(toRemove) } }) : [];

    if (toAdd.length) await manager.insert(MarketingCardLabel, toAdd.map((labelId) => ({ cardId: card.id, labelId, createdBy: event.userId })));
    if (toRemove.length) await manager.delete(MarketingCardLabel, { cardId: card.id, labelId: In(toRemove) });
    const record = (type: MarketingHistoryType, label: MarketingLabel, verb: string) =>
      this.history.record(manager, {
        ...event,
        type,
        description: `Etiqueta ${label.name} ${verb} card.`,
        metadata: { labelId: label.id, labelName: label.name, labelColor: label.color },
      });
    for (const label of added) await record(MarketingHistoryType.ETIQUETA_ADICIONADA, label, 'adicionada ao');
    for (const label of removed) await record(MarketingHistoryType.ETIQUETA_REMOVIDA, label, 'removida do');
    return true;
  }

  private async userNames(manager: EntityManager, userIds: string[]) {
    const rows: { id: string; name: string }[] = await manager.query(`SELECT id, full_name AS name FROM users WHERE id = ANY($1::uuid[])`, [userIds]);
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  /** URLs assinadas das capas. Falha do storage não derruba o quadro: o card só fica sem miniatura. */
  private async coverUrls(cards: MarketingCard[]): Promise<Record<string, string>> {
    const withCover = cards.filter((card) => card.coverAttachmentId);
    if (!withCover.length) return {};
    try {
      const attachments = await this.dataSource.getRepository(MarketingCardAttachment).find({
        where: { id: In(withCover.map((card) => card.coverAttachmentId)), isActive: true },
      });
      const urls = await this.storage.getSignedUrls(attachments.map((attachment) => attachment.storagePath));
      const byAttachment = new Map(attachments.map((attachment) => [attachment.id, urls[attachment.storagePath]]));
      return Object.fromEntries(withCover.filter((card) => byAttachment.get(card.coverAttachmentId)).map((card) => [card.id, byAttachment.get(card.coverAttachmentId)]));
    } catch (error) {
      this.logger.warn(`Capas do quadro sem URL: ${(error as Error).message}`);
      return {};
    }
  }

  private async readDetail(manager: EntityManager, id: string, organizationId: string) {
    const card = await manager.findOne(MarketingCard, { where: { id, organizationId } });
    if (!card) throw new NotFoundException('Card não encontrado.');
    const list = await manager.findOneOrFail(MarketingList, { where: { id: card.listId } });

    const members: { id: string; name: string }[] = await manager.query(
      `SELECT u.id, u.full_name AS name FROM marketing_card_members m JOIN users u ON u.id = m.user_id WHERE m.card_id = $1 ORDER BY m.created_at, u.id`,
      [id],
    );
    const labels: { id: string; name: string; color: string }[] = await manager.query(
      `SELECT l.id, l.name, l.color FROM marketing_card_labels cl JOIN marketing_labels l ON l.id = cl.label_id AND l.is_active = true
        WHERE cl.card_id = $1 ORDER BY l.name_normalized, l.id`,
      [id],
    );
    const tasks = await manager.find(MarketingCardTask, { where: { cardId: id, isActive: true }, order: { position: 'ASC', createdAt: 'ASC', id: 'ASC' } });
    const assigneeIds = [...new Set(tasks.map((task) => task.assigneeId).filter(Boolean))];
    const assignees = assigneeIds.length ? await this.userNames(manager, assigneeIds) : new Map<string, string>();
    const attachments = await manager.find(MarketingCardAttachment, { where: { cardId: id, isActive: true }, order: { createdAt: 'ASC', id: 'ASC' } });
    const urls = await this.signedUrls(attachments);
    const [{ total: commentsCount }] = await manager.query(`SELECT count(*)::int AS total FROM marketing_card_comments WHERE card_id = $1 AND is_active = true`, [id]);

    return {
      id: card.id,
      title: card.title,
      description: card.description ?? null,
      list: { id: list.id, name: list.name, color: list.color, isFinal: list.isFinal, isActive: list.isActive },
      listId: card.listId,
      position: card.position,
      dueDate: card.dueDate ?? null,
      publishDate: card.publishDate ?? null,
      ...dueInfo(card.isActive ? card.dueDate ?? null : null, list.isFinal),
      isArchived: !card.isActive,
      archivedAt: card.archivedAt,
      coverAttachmentId: card.coverAttachmentId,
      members,
      labels,
      tasks: tasks.map((task) => toTaskResponse(task, assignees.get(task.assigneeId) ?? null)),
      attachments: attachments.map((attachment) => toAttachmentResponse(attachment, urls, card.coverAttachmentId)),
      commentsCount,
      createdBy: card.createdBy,
      createdByName: card.createdByName,
      createdAt: card.createdAt,
      updatedBy: card.updatedBy ?? null,
      updatedByName: card.updatedByName ?? null,
      updatedAt: card.updatedAt,
    };
  }

  private async signedUrls(attachments: MarketingCardAttachment[]) {
    try {
      return await this.storage.getSignedUrls(attachments.map((attachment) => attachment.storagePath));
    } catch (error) {
      this.logger.warn(`Anexos sem URL assinada: ${(error as Error).message}`);
      return {};
    }
  }
}

type EventBase = { organizationId: string; card: { id: string; title: string }; userId: string; userName: string };
