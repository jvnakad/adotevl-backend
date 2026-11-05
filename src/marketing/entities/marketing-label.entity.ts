import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn, Index, Check } from 'typeorm';
import { Organization } from '../../organization/organization.entity';

/** Etiqueta colorida dos cards, definida pelo Admin. Começa vazia (sem seed). */
@Entity('marketing_labels')
@Index('UQ_marketing_labels_org_name_active', ['organizationId', 'nameNormalized'], { unique: true, where: '"is_active" = true' })
@Check('CHK_marketing_labels_name_not_blank', `btrim("name") <> '' AND "name_normalized" <> ''`)
@Check('CHK_marketing_labels_color_hex', `"color" ~ '^#[0-9A-F]{6}$'`)
export class MarketingLabel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Organization, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'organization_id', foreignKeyConstraintName: 'FK_marketing_labels_organization' })
  organization: Organization;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ name: 'name_normalized', type: 'varchar', length: 100 })
  nameNormalized: string;

  /** Hex '#RRGGBB' em maiúsculas */
  @Column({ type: 'varchar', length: 7 })
  color: string;

  /** Soft delete: ao excluir, a aplicação apaga os vínculos em marketing_card_labels na mesma transação */
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
