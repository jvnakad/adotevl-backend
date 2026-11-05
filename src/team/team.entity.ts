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

/** Equipes padrão que toda organização tem (nome travado; a Admin também tem a matriz travada). */
export enum TeamSystemKey {
  ADMIN = 'ADMIN',
  FINANCIAL = 'FINANCIAL',
  FIXED_VOLUNTEER = 'FIXED_VOLUNTEER',
  FLOATING_VOLUNTEER = 'FLOATING_VOLUNTEER',
  MARKETING = 'MARKETING',
}

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

  /** Equipe padrão do sistema (null = criada pelo Admin). */
  @Column({ name: 'system_key', type: 'enum', enum: TeamSystemKey, nullable: true })
  systemKey: TeamSystemKey | null;

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
