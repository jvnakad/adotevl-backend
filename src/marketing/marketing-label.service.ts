import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { MarketingLabel } from './entities/marketing-label.entity';
import { MarketingCardLabel } from './entities/marketing-card-label.entity';
import { MarketingHistoryType } from './entities/marketing-history-event.entity';
import { MarketingHistoryService } from './marketing-history.service';
import { CreateMarketingLabelDto, UpdateMarketingLabelDto } from './dto/marketing-label.dto';
import { normalizeName } from '../common/normalize-name';
import { toDuplicateNameError } from './marketing-errors';
import { MarketingRealtimeService, MARKETING_EVENTS } from './marketing-realtime.service';

const NOT_FOUND_MESSAGE = 'Etiqueta não encontrada.';
const DUPLICATE_MESSAGE = 'Já existe uma etiqueta com esse nome.';

@Injectable()
export class MarketingLabelService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly history: MarketingHistoryService,
    private readonly rt: MarketingRealtimeService,
  ) {}

  /** Etiquetas ativas (A→Z) com a quantidade de cards ativos que usam cada uma. */
  async findAll(organizationId: string) {
    const labels = await this.dataSource.getRepository(MarketingLabel).find({ where: { organizationId, isActive: true } });
    const usage = await this.usageByLabel(this.dataSource.manager, organizationId);
    return labels
      .sort((a, b) => a.nameNormalized.localeCompare(b.nameNormalized) || a.id.localeCompare(b.id))
      .map((label) => this.toResponse(label, usage.get(label.id) ?? 0));
  }

  async create(dto: CreateMarketingLabelDto, userId: string, organizationId: string) {
    try {
      const nameNormalized = normalizeName(dto.name);
      const repository = this.dataSource.getRepository(MarketingLabel);
      if (await repository.findOne({ where: { organizationId, nameNormalized, isActive: true }, select: { id: true } })) {
        throw new ConflictException(DUPLICATE_MESSAGE);
      }
      const saved = await repository.save(
        repository.create({ organizationId, name: dto.name, nameNormalized, color: dto.color, createdBy: userId, updatedBy: userId }),
      );
      await this.rt.publish(organizationId, userId, MARKETING_EVENTS.LABEL_CHANGED, { labelId: saved.id, action: 'created' });
      return this.toResponse(saved, 0);
    } catch (error) {
      throw toDuplicateNameError(error) ?? error;
    }
  }

  async update(id: string, dto: UpdateMarketingLabelDto, userId: string, organizationId: string) {
    if (dto.name === null || dto.color === null) throw new BadRequestException('Nome e cor da etiqueta são obrigatórios.');
    try {
      const repository = this.dataSource.getRepository(MarketingLabel);
      const label = await repository.findOne({ where: { id, organizationId, isActive: true } });
      if (!label) throw new NotFoundException(NOT_FOUND_MESSAGE);
      if (dto.name !== undefined && dto.name !== label.name) {
        const nameNormalized = normalizeName(dto.name);
        const clash = await repository.findOne({ where: { organizationId, nameNormalized, isActive: true }, select: { id: true } });
        if (clash && clash.id !== id) throw new ConflictException(DUPLICATE_MESSAGE);
        label.name = dto.name;
        label.nameNormalized = nameNormalized;
      }
      if (dto.color !== undefined) label.color = dto.color;
      label.updatedBy = userId;
      const saved = await repository.save(label);
      const usage = (await this.usageByLabel(this.dataSource.manager, organizationId)).get(id) ?? 0;
      await this.rt.publish(organizationId, userId, MARKETING_EVENTS.LABEL_CHANGED, { labelId: id, action: 'updated' });
      return this.toResponse(saved, usage);
    } catch (error) {
      throw toDuplicateNameError(error) ?? error;
    }
  }

  /** Aviso antes de excluir: quantos cards ativos usam a etiqueta. */
  async usage(id: string, organizationId: string) {
    const label = await this.dataSource.getRepository(MarketingLabel).findOne({ where: { id, organizationId, isActive: true } });
    if (!label) throw new NotFoundException(NOT_FOUND_MESSAGE);
    return { id, name: label.name, cardCount: (await this.usageByLabel(this.dataSource.manager, organizationId)).get(id) ?? 0 };
  }

  /** Soft delete + remove a etiqueta de todos os cards; cada card ativo afetado ganha ETIQUETA_REMOVIDA (reason LABEL_DELETED). */
  async remove(id: string, userId: string, organizationId: string) {
    const result = await this.dataSource.transaction(async (manager) => {
      const label = await manager.findOne(MarketingLabel, { where: { id, organizationId, isActive: true } });
      if (!label) throw new NotFoundException(NOT_FOUND_MESSAGE);

      const affected: { id: string; title: string }[] = await manager.query(
        `SELECT c.id, c.title FROM marketing_card_labels cl JOIN marketing_cards c ON c.id = cl.card_id
          WHERE cl.label_id = $1 AND c.organization_id = $2 AND c.is_active = true ORDER BY c.id`,
        [id, organizationId],
      );
      const userName = await this.history.resolveUserName(manager, userId);
      await manager.delete(MarketingCardLabel, { labelId: id });
      await manager.update(MarketingLabel, { id }, { isActive: false, updatedBy: userId });
      for (const card of affected) {
        // Etiquetas do card mudaram: sobe a versão do card e marca o evento com ela
        await manager.query('UPDATE marketing_cards SET version = version + 1 WHERE id = $1', [card.id]);
        const [{ version }] = await manager.query('SELECT version FROM marketing_cards WHERE id = $1', [card.id]);
        await this.history.record(manager, {
          version,
          organizationId,
          type: MarketingHistoryType.ETIQUETA_REMOVIDA,
          card,
          description: `Etiqueta ${label.name} removida do card (etiqueta excluída).`,
          metadata: { labelId: label.id, labelName: label.name, labelColor: label.color, reason: 'LABEL_DELETED' },
          userId,
          userName,
        });
      }
      return { message: 'Etiqueta excluída com sucesso.', removedFromCards: affected.length };
    });
    await this.rt.publish(organizationId, userId, MARKETING_EVENTS.LABEL_CHANGED, { labelId: id, action: 'deleted', removedFromCards: result.removedFromCards });
    return result;
  }

  private async usageByLabel(manager: EntityManager, organizationId: string) {
    const rows: { label_id: string; total: number }[] = await manager.query(
      `SELECT cl.label_id, count(*)::int AS total FROM marketing_card_labels cl JOIN marketing_cards c ON c.id = cl.card_id
        WHERE c.organization_id = $1 AND c.is_active = true GROUP BY cl.label_id`,
      [organizationId],
    );
    return new Map(rows.map((row) => [row.label_id, row.total]));
  }

  private toResponse(label: MarketingLabel, cardCount: number) {
    return { id: label.id, name: label.name, color: label.color, cardCount };
  }
}
