import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, Index, Check } from 'typeorm';
import { Organization } from '../../organization/organization.entity';
import { MarketingCard } from './marketing-card.entity';
import { MarketingList } from './marketing-list.entity';

/** Eventos do histórico do card (spec, seção 9). */
export enum MarketingHistoryType {
  CARD_CRIADO = 'CARD_CRIADO',
  CARD_MOVIDO = 'CARD_MOVIDO',
  CARD_EDITADO = 'CARD_EDITADO',
  CARD_ARQUIVADO = 'CARD_ARQUIVADO',
  CARD_RESTAURADO = 'CARD_RESTAURADO',
  MEMBRO_ADICIONADO = 'MEMBRO_ADICIONADO',
  MEMBRO_REMOVIDO = 'MEMBRO_REMOVIDO',
  ETIQUETA_ADICIONADA = 'ETIQUETA_ADICIONADA',
  ETIQUETA_REMOVIDA = 'ETIQUETA_REMOVIDA',
  ANEXO_ADICIONADO = 'ANEXO_ADICIONADO',
  ANEXO_REMOVIDO = 'ANEXO_REMOVIDO',
  SUBTAREFA_CONCLUIDA = 'SUBTAREFA_CONCLUIDA',
  COMENTARIO_ADICIONADO = 'COMENTARIO_ADICIONADO',
  DATAS_ALTERADAS = 'DATAS_ALTERADAS',
}

// Log do card: só recebe inserts (padrão stock_history_events). Sem is_active/updated_*: evento não muda.
@Entity('marketing_history_events')
// Aba Atividade do card (linha do tempo)
@Index('IDX_marketing_history_card_created_at', ['cardId', 'createdAt'])
// Consultas da organização por período e métricas futuras (tempo em cada fila)
@Index('IDX_marketing_history_org_created_at', ['organizationId', 'createdAt'])
@Index('IDX_marketing_history_org_type_created_at', ['organizationId', 'type', 'createdAt'])
@Check('CHK_marketing_history_from_list_pair', `("from_list_id" IS NULL) = ("from_list_name" IS NULL)`)
@Check('CHK_marketing_history_to_list_pair', `("to_list_id" IS NULL) = ("to_list_name" IS NULL)`)
// Mover = troca de fila (reordenar na mesma fila não gera evento); criar registra a fila inicial
@Check(
  'CHK_marketing_history_moved_lists',
  `"type" <> 'CARD_MOVIDO' OR ("from_list_id" IS NOT NULL AND "to_list_id" IS NOT NULL AND "from_list_id" <> "to_list_id")`,
)
@Check('CHK_marketing_history_created_list', `"type" <> 'CARD_CRIADO' OR "to_list_id" IS NOT NULL`)
export class MarketingHistoryEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Organization, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'organization_id', foreignKeyConstraintName: 'FK_marketing_history_organization' })
  organization: Organization;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ type: 'enum', enum: MarketingHistoryType })
  type: MarketingHistoryType;

  // RESTRICT: apagar o card nunca apaga a auditoria (o módulo só arquiva)
  @ManyToOne(() => MarketingCard, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'card_id', foreignKeyConstraintName: 'FK_marketing_history_card' })
  card: MarketingCard;

  @Column({ name: 'card_id', type: 'uuid' })
  cardId: string;

  /** Snapshot do título do card depois da ação */
  @Column({ name: 'card_title', type: 'varchar', length: 500 })
  cardTitle: string;

  /** Fila de origem (CARD_MOVIDO) */
  @ManyToOne(() => MarketingList, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'from_list_id', foreignKeyConstraintName: 'FK_marketing_history_from_list' })
  fromList: MarketingList | null;

  @Column({ name: 'from_list_id', type: 'uuid', nullable: true })
  fromListId: string | null;

  /** Snapshot do nome da fila de origem */
  @Column({ name: 'from_list_name', type: 'varchar', length: 100, nullable: true })
  fromListName: string | null;

  /** Fila de destino (CARD_MOVIDO) ou fila inicial (CARD_CRIADO, CARD_RESTAURADO) */
  @ManyToOne(() => MarketingList, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'to_list_id', foreignKeyConstraintName: 'FK_marketing_history_to_list' })
  toList: MarketingList | null;

  @Column({ name: 'to_list_id', type: 'uuid', nullable: true })
  toListId: string | null;

  @Column({ name: 'to_list_name', type: 'varchar', length: 100, nullable: true })
  toListName: string | null;

  /** Texto pronto em PT-BR */
  @Column({ type: 'text' })
  description: string;

  /** De/para e dados do evento (formato em docs/db/marketing.md) */
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  // Snapshot: req.user não tem nome e o usuário pode ser renomeado/removido depois
  @Column({ name: 'user_name', type: 'varchar' })
  userName: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
