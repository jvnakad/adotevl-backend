import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn, Index, Check } from 'typeorm';
import { Organization } from '../organization/organization.entity';

/** Tipo de produto do estoque, definido pela organização (sem seed). */
@Entity('product_types')
// Nome único só entre ativos (D-02); o where não é comparado pelo sync: mudou o predicado, troque o nome do índice
@Index('UQ_product_types_org_name_active', ['organizationId', 'nameNormalized'], { unique: true, where: '"is_active" = true' })
@Check('CHK_product_types_name_not_blank', `btrim("name") <> '' AND "name_normalized" <> ''`)
export class ProductType {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Organization, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'organization_id', foreignKeyConstraintName: 'FK_product_types_organization' })
  organization: Organization;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  /** Nome de exibição já com espaços normalizados (normalizeDisplayName) */
  @Column({ type: 'varchar', length: 250 })
  name: string;

  /** normalizeName(name): sem acento e minúsculo; usado na unicidade e na ordem alfabética */
  @Column({ name: 'name_normalized', type: 'varchar', length: 250 })
  nameNormalized: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
