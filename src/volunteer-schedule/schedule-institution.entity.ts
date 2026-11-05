import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn, Index, Check } from 'typeorm';
import { Organization } from '../organization/organization.entity';

/** Faculdades criadas uma única vez por organização (RN-02). Ver docs/db/agenda-faculdade.md, seção 4. */
export const DEFAULT_SCHEDULE_INSTITUTIONS = ['PUCPR'];

/** Faculdade do programa de horas complementares, mantida pelo Admin na Configuração da Agenda. */
@Entity('schedule_institutions')
// Único entre ativas e inativas: reativar nunca colide (RN-01)
@Index('UQ_schedule_institutions_org_name', ['organizationId', 'nameNormalized'], { unique: true })
// Select da LP/painel (só ativas) e aba Faculdades, por nome
@Index('IDX_schedule_institutions_org_active_name', ['organizationId', 'isActive', 'name'])
@Check('CHK_schedule_institutions_name_not_blank', `btrim("name") <> '' AND "name" = btrim("name") AND "name_normalized" <> ''`)
export class ScheduleInstitution {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Organization, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'organization_id', foreignKeyConstraintName: 'FK_schedule_institutions_organization' })
  organization: Organization;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  /** Nome de exibição (normalizeDisplayName), até 80 caracteres */
  @Column({ type: 'varchar', length: 80 })
  name: string;

  /** normalizeName(name): minúsculo e sem acento; usado na unicidade */
  @Column({ name: 'name_normalized', type: 'varchar', length: 80 })
  nameNormalized: string;

  /** Inativa some das listas e é recusada em reservas novas (RN-04). Excluir é DELETE físico, só se nunca usada (FK RESTRICT) */
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
