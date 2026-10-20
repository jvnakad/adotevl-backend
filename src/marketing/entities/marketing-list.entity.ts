import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn, Index, Check } from 'typeorm';
import { Organization } from '../../organization/organization.entity';

/**
 * Distância entre posições vizinhas (filas, cards e subtarefas). Inserir entre A e B usa o meio
 * (floor((A + B) / 2)); sem espaço (B - A < 2), a lista inteira é renumerada na mesma transação
 * com este passo. Ver docs/db/marketing.md, seção "Estratégia de position".
 */
export const MARKETING_POSITION_GAP = 1024;

/** Filas criadas para toda organização (D-01). Ordem do array = ordem no quadro. */
export const DEFAULT_MARKETING_LISTS: { name: string; color: string; isFinal: boolean }[] = [
  { name: 'Releases', color: '#6938EF', isFinal: false },
  { name: 'Banco de Ideias', color: '#FDB022', isFinal: false },
  { name: 'Pautas', color: '#1570EF', isFinal: false },
  { name: 'Criação', color: '#FB6514', isFinal: false },
  { name: 'Ajustes', color: '#C11574', isFinal: false },
  { name: 'Aprovação', color: '#15B79E', isFinal: false },
  { name: 'Postado', color: '#027A48', isFinal: true },
];

/** Fila (coluna) do quadro de Marketing, definida pelo Admin. Um quadro por organização. */
@Entity('marketing_lists')
// Nome único só entre ativas; o where não é comparado pelo sync: mudou o predicado, troque o nome do índice
@Index('UQ_marketing_lists_org_name_active', ['organizationId', 'nameNormalized'], { unique: true, where: '"is_active" = true' })
// No máximo uma fila final ativa por organização (D-10: card nela não fica atrasado)
@Index('UQ_marketing_lists_org_final_active', ['organizationId'], { unique: true, where: '"is_final" = true AND "is_active" = true' })
// Quadro e Configuração listam as filas ativas pela ordem
@Index('IDX_marketing_lists_org_position', ['organizationId', 'isActive', 'position'])
@Check('CHK_marketing_lists_name_not_blank', `btrim("name") <> '' AND "name_normalized" <> ''`)
@Check('CHK_marketing_lists_color_hex', `"color" ~ '^#[0-9A-F]{6}$'`)
export class MarketingList {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Organization, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'organization_id', foreignKeyConstraintName: 'FK_marketing_lists_organization' })
  organization: Organization;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  /** Nome de exibição (normalizeDisplayName) */
  @Column({ type: 'varchar', length: 100 })
  name: string;

  /** normalizeName(name): sem acento e minúsculo; usado na unicidade */
  @Column({ name: 'name_normalized', type: 'varchar', length: 100 })
  nameNormalized: string;

  /** Hex '#RRGGBB' em maiúsculas (a aplicação converte antes de gravar) */
  @Column({ type: 'varchar', length: 7 })
  color: string;

  /** Ordem no quadro (inteiro esparso, passo MARKETING_POSITION_GAP) */
  @Column({ type: 'integer' })
  position: number;

  /** Fila final (padrão "Postado"): card nela não conta como atrasado (D-10) */
  @Column({ name: 'is_final', default: false })
  isFinal: boolean;

  /** Soft delete: só fila sem cards ativos pode ser excluída (D-04) */
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
