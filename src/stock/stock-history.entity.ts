import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, Index, Check } from 'typeorm';
import { Organization } from '../organization/organization.entity';
import { Product } from './product.entity';
import { ProductType } from './product-type.entity';

export enum StockHistoryType {
  PRODUTO_CRIADO = 'PRODUTO_CRIADO',
  PRODUTO_EDITADO = 'PRODUTO_EDITADO',
  PRODUTO_REMOVIDO = 'PRODUTO_REMOVIDO',
  TIPO_CRIADO = 'TIPO_CRIADO',
  TIPO_RENOMEADO = 'TIPO_RENOMEADO',
  TIPO_REMOVIDO = 'TIPO_REMOVIDO',
}

// Log do estoque: só recebe inserts (RN-39). Sem is_active/updated_*: evento não muda.
@Entity('stock_history_events')
@Index('IDX_stock_history_org_created_at', ['organizationId', 'createdAt'])
@Index('IDX_stock_history_org_user_created_at', ['organizationId', 'userId', 'createdAt'])
@Index('IDX_stock_history_org_type_created_at', ['organizationId', 'type', 'createdAt'])
// Busca por qualquer nome que o item já teve (Q-01): a 2a etapa traz os eventos do item
@Index('IDX_stock_history_product', ['productId'])
@Index('IDX_stock_history_product_type', ['productTypeId'])
// Evento PRODUTO_* aponta só para produto; TIPO_* só para tipo. Mudou a expressão, troque o nome (o sync compara por nome)
@Check(
  'CHK_stock_history_subject',
  `num_nonnulls("product_id", "product_type_id") = 1 AND (("type"::text LIKE 'PRODUTO\\_%') = ("product_id" IS NOT NULL))`,
)
@Check('CHK_stock_history_previous_pair', `("previous_subject_name" IS NULL) = ("previous_subject_name_normalized" IS NULL)`)
@Check('CHK_stock_history_rename_has_previous', `"type" <> 'TIPO_RENOMEADO' OR "previous_subject_name" IS NOT NULL`)
export class StockHistoryEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Organization, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'organization_id', foreignKeyConstraintName: 'FK_stock_history_organization' })
  organization: Organization;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ type: 'enum', enum: StockHistoryType })
  type: StockHistoryType;

  // RESTRICT: apagar o produto nunca apaga a auditoria (o módulo só faz soft delete)
  @ManyToOne(() => Product, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_id', foreignKeyConstraintName: 'FK_stock_history_product' })
  product: Product | null;

  @Column({ name: 'product_id', type: 'uuid', nullable: true })
  productId: string | null;

  @ManyToOne(() => ProductType, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_type_id', foreignKeyConstraintName: 'FK_stock_history_product_type' })
  productType: ProductType | null;

  @Column({ name: 'product_type_id', type: 'uuid', nullable: true })
  productTypeId: string | null;

  /** Snapshot do nome do produto/tipo após a ação (RN-42) */
  @Column({ name: 'subject_name', type: 'varchar', length: 250 })
  subjectName: string;

  /** normalizeName(subjectName): busca sem acento e maiúscula */
  @Column({ name: 'subject_name_normalized', type: 'varchar', length: 250 })
  subjectNameNormalized: string;

  /** Nome anterior quando o nome mudou (TIPO_RENOMEADO, PRODUTO_EDITADO com troca de nome) */
  @Column({ name: 'previous_subject_name', type: 'varchar', length: 250, nullable: true })
  previousSubjectName: string | null;

  @Column({ name: 'previous_subject_name_normalized', type: 'varchar', length: 250, nullable: true })
  previousSubjectNameNormalized: string | null;

  @Column({ type: 'text' })
  description: string;

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
