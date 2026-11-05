import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, Unique } from 'typeorm';
import { Organization } from '../organization/organization.entity';
import { dateColumnTransformer } from './schedule-time';

/** Dia trancado na agenda: ninguém marca; a mensagem aparece na LP e no sistema. */
@Entity('schedule_locks')
@Unique(['organizationId', 'date'])
export class ScheduleLock {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Organization, { nullable: false })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column({ type: 'date', transformer: dateColumnTransformer })
  date: string;

  @Column({ type: 'varchar', length: 200 })
  message: string;

  @Column({ name: 'created_by', nullable: true })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
