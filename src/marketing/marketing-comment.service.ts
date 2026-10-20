import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { MarketingCardComment, MarketingCommentMention } from './entities/marketing-card-comment.entity';
import { MarketingHistoryType } from './entities/marketing-history-event.entity';
import { MarketingHistoryService } from './marketing-history.service';
import { MarketingEligibilityService } from './marketing-eligibility.service';
import { CreateMarketingCommentDto, UpdateMarketingCommentDto } from './dto/marketing-comment.dto';
import { PaginationDto } from '../common/pagination.dto';
import { requireCard } from './marketing-card.helper';
import { toCommentResponse } from './marketing-presenter';

const NOT_FOUND_MESSAGE = 'Comentário não encontrado.';
const EXCERPT_LENGTH = 140;

@Injectable()
export class MarketingCommentService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly history: MarketingHistoryService,
    private readonly eligibility: MarketingEligibilityService,
  ) {}

  /** Mais recente primeiro. */
  async findAll(cardId: string, query: PaginationDto, organizationId: string) {
    await requireCard(this.dataSource.manager, cardId, organizationId);
    const { page = 1, limit = 10 } = query;
    const [comments, total] = await this.dataSource.getRepository(MarketingCardComment).findAndCount({
      where: { cardId, isActive: true },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data: comments.map(toCommentResponse), total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async create(cardId: string, dto: CreateMarketingCommentDto, userId: string, organizationId: string) {
    return this.dataSource.transaction(async (manager) => {
      const card = await requireCard(manager, cardId, organizationId, { lock: true, mutation: true });
      const userName = await this.history.resolveUserName(manager, userId);
      const mentions = await this.resolveMentions(manager, organizationId, dto);
      const comment = await manager.save(
        manager.create(MarketingCardComment, { cardId, body: dto.body, mentions, authorId: userId, authorName: userName, updatedBy: null }),
      );
      await this.history.record(manager, {
        organizationId,
        type: MarketingHistoryType.COMENTARIO_ADICIONADO,
        card,
        description: `Comentário adicionado ao card "${card.title}".`,
        metadata: { commentId: comment.id, excerpt: dto.body.slice(0, EXCERPT_LENGTH) },
        userId,
        userName,
      });
      // Ponto de extensão (C12): notificar aqui os mencionados (comment.mentions) e os membros do card, exceto o autor.
      return toCommentResponse(comment);
    });
  }

  /** Só o autor edita. Só marca edited_at (sem evento no histórico); sem mudança no texto nada é gravado. */
  async update(cardId: string, commentId: string, dto: UpdateMarketingCommentDto, userId: string, organizationId: string) {
    return this.dataSource.transaction(async (manager) => {
      await requireCard(manager, cardId, organizationId, { lock: true, mutation: true });
      const comment = await this.requireComment(manager, cardId, commentId);
      if (comment.authorId !== userId) throw new ForbiddenException('Só o autor pode editar o comentário.');
      if (dto.body === comment.body) return toCommentResponse(comment);

      comment.body = dto.body;
      comment.mentions = await this.resolveMentions(manager, organizationId, dto);
      comment.editedAt = new Date();
      comment.updatedBy = userId;
      // Ponto de extensão (C12): notificar só quem entrou em mentions nesta edição.
      return toCommentResponse(await manager.save(comment));
    });
  }

  /** Autor exclui o próprio; Admin exclui qualquer um. */
  async remove(cardId: string, commentId: string, userId: string, organizationId: string, isAdmin: boolean) {
    await this.dataSource.transaction(async (manager) => {
      await requireCard(manager, cardId, organizationId, { lock: true, mutation: true });
      const comment = await this.requireComment(manager, cardId, commentId);
      if (comment.authorId !== userId && !isAdmin) throw new ForbiddenException('Só o autor ou um administrador pode excluir o comentário.');
      await manager.update(MarketingCardComment, { id: commentId }, { isActive: false, updatedBy: userId });
    });
    return { message: 'Comentário excluído com sucesso.' };
  }

  private async requireComment(manager: EntityManager, cardId: string, commentId: string) {
    const comment = await manager.findOne(MarketingCardComment, { where: { id: commentId, cardId, isActive: true } });
    if (!comment) throw new NotFoundException(NOT_FOUND_MESSAGE);
    return comment;
  }

  /** Mantém só quem tem Editar em Marketing e cujo "@Nome" aparece no texto; grava o nome atual de cada um. */
  private async resolveMentions(manager: EntityManager, organizationId: string, dto: CreateMarketingCommentDto): Promise<MarketingCommentMention[]> {
    if (!dto.body) throw new BadRequestException('Escreva o comentário.');
    const eligible = await this.eligibility.filterEligible(organizationId, dto.mentionUserIds ?? [], manager);
    const text = dto.body.toLowerCase();
    return eligible.filter((user) => text.includes(`@${user.name.toLowerCase()}`)).map((user) => ({ userId: user.id, name: user.name }));
  }
}
