import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn, Index, Check } from 'typeorm';
import { User } from '../../user/user.entity';
import { dateColumnTransformer } from '../../volunteer-schedule/schedule-time';
import { MarketingCard } from './marketing-card.entity';

/** Subtarefa (item do checklist) do card (D-07). */
@Entity('marketing_card_tasks')
// Checklist do card na ordem; progresso x/y do quadro (COUNT por card_id)
@Index('IDX_marketing_card_tasks_card_position', ['cardId', 'isActive', 'position'])
// Subtarefas atribuídas a um usuário (notificações / filtro futuro)
@Index('IDX_marketing_card_tasks_assignee', ['assigneeId'])
@Check('CHK_marketing_card_tasks_title_not_blank', `btrim("title") <> ''`)
@Check('CHK_marketing_card_tasks_done_pair', `("is_done" = false AND "done_at" IS NULL AND "done_by" IS NULL) OR ("is_done" = true AND "done_at" IS NOT NULL)`)
export class MarketingCardTask {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => MarketingCard, (card) => card.tasks, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'card_id', foreignKeyConstraintName: 'FK_marketing_card_tasks_card' })
  card: MarketingCard;

  @Column({ name: 'card_id', type: 'uuid' })
  cardId: string;

  @Column({ type: 'varchar', length: 500 })
  title: string;

  /** Ordem no checklist (inteiro esparso, passo MARKETING_POSITION_GAP) */
  @Column({ type: 'integer' })
  position: number;

  @Column({ name: 'is_done', default: false })
  isDone: boolean;

  @Column({ name: 'done_at', type: 'timestamptz', nullable: true })
  doneAt: Date | null;

  @Column({ name: 'done_by', type: 'uuid', nullable: true })
  doneBy: string | null;

  // Responsável opcional (mesma regra de membro, D-09). SET NULL: usuário apagado fisicamente não apaga a subtarefa
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assignee_id', foreignKeyConstraintName: 'FK_marketing_card_tasks_assignee' })
  assignee: User | null;

  @Column({ name: 'assignee_id', type: 'uuid', nullable: true })
  assigneeId: string | null;

  /** Prazo opcional 'YYYY-MM-DD' */
  @Column({ name: 'due_date', type: 'date', nullable: true, transformer: dateColumnTransformer })
  dueDate: string | null;

  /** Soft delete (excluir subtarefa) */
  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
