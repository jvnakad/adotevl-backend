import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { User } from '../user/user.entity';
import { Organization } from '../organization/organization.entity';
import { dateColumnTransformer } from './schedule-time';

/** Horário de voluntariado marcado na agenda (um voluntário, um dia, início e fim). */
@Entity('volunteer_shifts')
@Index(['organizationId', 'date'])
export class VolunteerShift {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Organization, { nullable: false })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id' })
  userId: string;

  /** 'YYYY-MM-DD' */
  @Column({ type: 'date', transformer: dateColumnTransformer })
  date: string;

  /** 'HH:MM' */
  @Column({ name: 'start_time', type: 'varchar', length: 5 })
  startTime: string;

  @Column({ name: 'end_time', type: 'varchar', length: 5 })
  endTime: string;

  @Column({ type: 'varchar', length: 300, nullable: true })
  notes: string | null;

  /** Link "Desmarcar" do e-mail de confirmação */
  @Column({ name: 'cancel_token', type: 'uuid', unique: true })
  cancelToken: string;

  /** Cancelado (pelo voluntário, pelo admin ou por dia trancado); null = marcado */
  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({ name: 'cancel_reason', type: 'varchar', nullable: true })
  cancelReason: string | null;

  @Column({ name: 'created_by', nullable: true })
  createdBy: string;

  @Column({ name: 'updated_by', nullable: true })
  updatedBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
