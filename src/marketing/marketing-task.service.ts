import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { MarketingCardTask } from './entities/marketing-card-task.entity';
import { MarketingHistoryType } from './entities/marketing-history-event.entity';
import { MarketingHistoryService } from './marketing-history.service';
import { MarketingEligibilityService } from './marketing-eligibility.service';
import { CreateMarketingTaskDto, UpdateMarketingTaskDto } from './dto/marketing-task.dto';
import { MoveByIndexDto } from './dto/marketing-list.dto';
import { requireCard } from './marketing-card.helper';
import { resolvePosition } from './marketing-position';
import { toTaskResponse } from './marketing-presenter';

const NOT_FOUND_MESSAGE = 'Subtarefa não encontrada.';
const ASSIGNEE_MESSAGE = 'Só quem tem permissão de edição no Marketing pode ser responsável pela subtarefa.';

/** Checklist do card (D-07). Toda operação trava o card (FOR UPDATE), que também serializa a ordem das subtarefas. */
@Injectable()
export class MarketingTaskService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly history: MarketingHistoryService,
    private readonly eligibility: MarketingEligibilityService,
  ) {}

  async findAll(cardId: string, organizationId: string) {
    await requireCard(this.dataSource.manager, cardId, organizationId);
    const tasks = await this.dataSource.getRepository(MarketingCardTask).find({
      where: { cardId, isActive: true },
      order: { position: 'ASC', createdAt: 'ASC', id: 'ASC' },
    });
    return this.present(this.dataSource.manager, tasks);
  }

  async create(cardId: string, dto: CreateMarketingTaskDto, userId: string, organizationId: string) {
    return this.dataSource.transaction(async (manager) => {
      await requireCard(manager, cardId, organizationId, { lock: true, mutation: true });
      if (dto.assigneeId) await this.assertEligible(manager, organizationId, dto.assigneeId);
      const siblings = await this.activeTasks(manager, cardId);
      const { position } = await resolvePosition(manager, 'marketing_card_tasks', siblings, null, siblings.length);
      const task = await manager.save(
        manager.create(MarketingCardTask, {
          cardId,
          title: dto.title,
          position,
          assigneeId: dto.assigneeId ?? null,
          dueDate: dto.dueDate ?? null,
          createdBy: userId,
          updatedBy: userId,
        }),
      );
      return (await this.present(manager, [task]))[0];
    });
  }

  async update(cardId: string, taskId: string, dto: UpdateMarketingTaskDto, userId: string, organizationId: string) {
    if (dto.title === null) throw new BadRequestException('Informe o texto da subtarefa.');
    if (dto.isDone === null) throw new BadRequestException('Informe se a subtarefa está concluída.');

    return this.dataSource.transaction(async (manager) => {
      const card = await requireCard(manager, cardId, organizationId, { lock: true, mutation: true });
      const task = await this.requireTask(manager, cardId, taskId);

      if (dto.title !== undefined) task.title = dto.title;
      if (dto.dueDate !== undefined) task.dueDate = dto.dueDate ?? null;
      // Só valida quem é novo: responsável que perdeu o Editar pode continuar (mesma regra dos membros)
      if (dto.assigneeId !== undefined && (dto.assigneeId ?? null) !== task.assigneeId) {
        if (dto.assigneeId) await this.assertEligible(manager, organizationId, dto.assigneeId);
        task.assigneeId = dto.assigneeId ?? null;
      }
      if (dto.isDone !== undefined && dto.isDone !== task.isDone) {
        task.isDone = dto.isDone;
        task.doneAt = dto.isDone ? new Date() : null;
        task.doneBy = dto.isDone ? userId : null;
        if (dto.isDone) {
          await this.history.record(manager, {
            organizationId,
            type: MarketingHistoryType.SUBTAREFA_CONCLUIDA,
            card,
            description: `Subtarefa "${task.title}" concluída.`,
            metadata: { taskId: task.id, taskTitle: task.title },
            userId,
            userName: await this.history.resolveUserName(manager, userId),
          });
        }
      }
      task.updatedBy = userId;
      return (await this.present(manager, [await manager.save(task)]))[0];
    });
  }

  async move(cardId: string, taskId: string, dto: MoveByIndexDto, userId: string, organizationId: string) {
    return this.dataSource.transaction(async (manager) => {
      await requireCard(manager, cardId, organizationId, { lock: true, mutation: true });
      await this.requireTask(manager, cardId, taskId);
      const siblings = (await this.activeTasks(manager, cardId)).filter((task) => task.id !== taskId);
      const { position, renumbered } = await resolvePosition(manager, 'marketing_card_tasks', siblings, taskId, dto.index);
      await manager.update(MarketingCardTask, { id: taskId }, { position, updatedBy: userId });
      return { id: taskId, position, renumbered };
    });
  }

  async remove(cardId: string, taskId: string, userId: string, organizationId: string) {
    await this.dataSource.transaction(async (manager) => {
      await requireCard(manager, cardId, organizationId, { lock: true, mutation: true });
      await this.requireTask(manager, cardId, taskId);
      await manager.update(MarketingCardTask, { id: taskId }, { isActive: false, updatedBy: userId });
    });
    return { message: 'Subtarefa excluída com sucesso.' };
  }

  private async requireTask(manager: EntityManager, cardId: string, taskId: string) {
    const task = await manager.findOne(MarketingCardTask, { where: { id: taskId, cardId, isActive: true } });
    if (!task) throw new NotFoundException(NOT_FOUND_MESSAGE);
    return task;
  }

  private activeTasks(manager: EntityManager, cardId: string) {
    return manager.find(MarketingCardTask, {
      where: { cardId, isActive: true },
      order: { position: 'ASC', createdAt: 'ASC', id: 'ASC' },
      select: { id: true, position: true },
    });
  }

  private async assertEligible(manager: EntityManager, organizationId: string, userId: string) {
    if (!(await this.eligibility.filterEligible(organizationId, [userId], manager)).length) throw new BadRequestException(ASSIGNEE_MESSAGE);
  }

  private async present(manager: EntityManager, tasks: MarketingCardTask[]) {
    const ids = [...new Set(tasks.map((task) => task.assigneeId).filter(Boolean))];
    const rows: { id: string; name: string }[] = ids.length ? await manager.query(`SELECT id, full_name AS name FROM users WHERE id = ANY($1::uuid[])`, [ids]) : [];
    const names = new Map(rows.map((row) => [row.id, row.name]));
    return tasks.map((task) => toTaskResponse(task, names.get(task.assigneeId) ?? null));
  }
}
