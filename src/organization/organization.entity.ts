import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('organizations')
export class Organization {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'legal_name' })
  legalName: string;

  @Column({ unique: true })
  cnpj: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ default: true })
  isActive: boolean;

  /** Seed da PUCPR na agenda já rodou (roda uma vez; ver docs/db/agenda-faculdade.md, seção 4) */
  @Column({ name: 'schedule_institutions_seeded_at', type: 'timestamptz', nullable: true })
  scheduleInstitutionsSeededAt: Date | null;

  /** Migração inicial de acesso por perfil já decidida (RN-33, SEC-16). Só a AccessMigrationService escreve. Ver docs/db/refresh-token.md */
  @Column({ name: 'access_migrated_at', type: 'timestamptz', nullable: true })
  accessMigratedAt: Date | null;

  @Column({ name: 'created_by', nullable: true })
  createdBy: string;

  @Column({ name: 'updated_by', nullable: true })
  updatedBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
