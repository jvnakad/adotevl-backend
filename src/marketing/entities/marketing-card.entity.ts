import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Check,
} from 'typeorm';
import { Organization } from '../../organization/organization.entity';
import { dateColumnTransformer } from '../../volunteer-schedule/schedule-time';
import { MarketingList } from './marketing-list.entity';
import { MarketingCardMember } from './marketing-card-member.entity';
import { MarketingCardLabel } from './marketing-card-label.entity';
import { MarketingCardTask } from './marketing-card-task.entity';
import { MarketingCardAttachment } from './marketing-card-attachment.entity';
import { MarketingCardComment } from './marketing-card-comment.entity';

/** Atividade do Marketing. Fica em uma fila; arquivar = soft delete (D-02). */
@Entity('marketing_cards')
// Quadro: cards ativos de cada fila pela ordem; também serve a checagem "fila tem cards ativos?" (D-04)
@Index('IDX_marketing_cards_list_position', ['listId', 'isActive', 'position'])
// Lista de arquivados da organização, do mais recente
@Index('IDX_marketing_cards_org_archived_at', ['organizationId', 'archivedAt'])
// Calendário (C17) e selo de atrasado (C16) por prazo
@Index('IDX_marketing_cards_org_due_date', ['organizationId', 'dueDate'])
@Check('CHK_marketing_cards_title_not_blank', `btrim("title") <> '' AND "title_normalized" <> ''`)
@Check('CHK_marketing_cards_archived_pair', `("is_active" = true) = ("archived_at" IS NULL)`)
@Check('CHK_marketing_cards_updated_by_pair', `("updated_by" IS NULL) = ("updated_by_name" IS NULL)`)
export class MarketingCard {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Organization, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'organization_id', foreignKeyConstraintName: 'FK_marketing_cards_organization' })
  organization: Organization;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  // RESTRICT: fila nunca é apagada fisicamente (soft delete); card arquivado pode apontar para fila inativa
  @ManyToOne(() => MarketingList, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'list_id', foreignKeyConstraintName: 'FK_marketing_cards_list' })
  list: MarketingList;

  @Column({ name: 'list_id', type: 'uuid' })
  listId: string;

  /** Ordem dentro da fila (inteiro esparso, passo MARKETING_POSITION_GAP); desempate por created_at, id */
  @Column({ type: 'integer' })
  position: number;

  /** Título de exibição (normalizeDisplayName) */
  @Column({ type: 'varchar', length: 500 })
  title: string;

  /** normalizeName(title): filtro de texto do quadro sem acento/maiúscula (C13) */
  @Column({ name: 'title_normalized', type: 'varchar', length: 500 })
  titleNormalized: string;

  /**
   * Versão dos CAMPOS do card (título, descrição, datas, fila, membros, etiquetas): começa em 1 e sobe 1 a cada alteração real.
   * O cliente envia baseVersion no PATCH; os campos alterados desde ela vêm dos eventos do histórico com version > baseVersion.
   * Mover dentro da mesma fila, arquivar, subtarefas, anexos e comentários não mudam a versão.
   */
  @Column({ type: 'integer', default: 1 })
  version: number;

  /** Texto livre com quebras de linha; null no lugar de string vazia */
  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** Prazo de entrega 'YYYY-MM-DD' (C16); nunca new Date('YYYY-MM-DD') */
  @Column({ name: 'due_date', type: 'date', nullable: true, transformer: dateColumnTransformer })
  dueDate: string | null;

  /** Data de publicação 'YYYY-MM-DD' (C16) */
  @Column({ name: 'publish_date', type: 'date', nullable: true, transformer: dateColumnTransformer })
  publishDate: string | null;

  // Capa do card (C7). SET NULL só age em DELETE físico; no soft delete do anexo o service limpa a capa
  @ManyToOne(() => MarketingCardAttachment, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'cover_attachment_id', foreignKeyConstraintName: 'FK_marketing_cards_cover_attachment' })
  coverAttachment: MarketingCardAttachment | null;

  @Column({ name: 'cover_attachment_id', type: 'uuid', nullable: true })
  coverAttachmentId: string | null;

  /** false = arquivado (D-02). Só Admin restaura */
  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  /** Quando foi arquivado (ordem da lista de arquivados). null enquanto ativo */
  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt: Date | null;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  // Snapshot: "Criado por" não muda se o usuário for renomeado/removido
  @Column({ name: 'created_by_name', type: 'varchar' })
  createdByName: string;

  /** null até a primeira edição real (mover não conta como edição) */
  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy: string | null;

  @Column({ name: 'updated_by_name', type: 'varchar', nullable: true })
  updatedByName: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => MarketingCardMember, (member) => member.card)
  members: MarketingCardMember[];

  @OneToMany(() => MarketingCardLabel, (cardLabel) => cardLabel.card)
  cardLabels: MarketingCardLabel[];

  @OneToMany(() => MarketingCardTask, (task) => task.card)
  tasks: MarketingCardTask[];

  @OneToMany(() => MarketingCardAttachment, (attachment) => attachment.card)
  attachments: MarketingCardAttachment[];

  @OneToMany(() => MarketingCardComment, (comment) => comment.card)
  comments: MarketingCardComment[];
}
