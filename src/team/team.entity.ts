import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Organization } from '../organization/organization.entity';

@Entity('teams')
export class Team {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @ManyToOne(() => Organization, { nullable: false })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'organization_id' })
  organizationId: string;

  /** Equipe de sistema "Admin": Editar em tudo, não pode ser editada, renomeada nem desativada. Uma por organização. */
  @Column({ name: 'is_admin', default: false })
  isAdmin: boolean;

  /**
   * Quando a matriz de permissões passou a valer (criação no sistema de equipes ou edição da matriz).
   * null = equipe anterior às permissões: a migração dá a ela o acesso dos perfis antigos dos membros.
   */
  @Column({ name: 'access_configured_at', type: 'timestamptz', nullable: true })
  accessConfiguredAt: Date | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'created_by', nullable: true })
  createdBy: string;

  @Column({ name: 'updated_by', nullable: true })
  updatedBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
