import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn, Index, Check } from 'typeorm';
import { User } from '../user/user.entity';
import { Organization } from '../organization/organization.entity';
import { dateColumnTransformer } from './schedule-time';
import { ScheduleInstitution } from './schedule-institution.entity';

/** Horário de voluntariado marcado na agenda (um voluntário, um dia, início e fim). */
@Entity('volunteer_shifts')
@Index(['organizationId', 'date'])
// Contagem "turnos usando esta faculdade" e checagem do RESTRICT; parcial porque a maioria dos turnos não é do programa
@Index('IDX_volunteer_shifts_institution', ['institutionId'], { where: '"institution_id" IS NOT NULL' })
// Faculdade, snapshot e curso andam juntos (RN-09, RN-12); curso já vem com trim (RN-08)
@Check(
  'CHK_volunteer_shifts_program_fields',
  `("institution_id" IS NULL AND "institution_name" IS NULL AND "course" IS NULL) OR ("institution_id" IS NOT NULL AND "institution_name" IS NOT NULL AND "course" IS NOT NULL AND char_length("course") >= 2 AND "course" = btrim("course"))`,
)
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

  /** Faculdade do programa; RESTRICT = faculdade usada não pode ser excluída (RN-03) */
  @ManyToOne(() => ScheduleInstitution, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'institution_id', foreignKeyConstraintName: 'FK_volunteer_shifts_institution' })
  institution: ScheduleInstitution | null;

  @Column({ name: 'institution_id', type: 'uuid', nullable: true })
  institutionId: string | null;

  /** Nome da faculdade no momento da reserva (RN-05): o selo e o e-mail leem daqui */
  @Column({ name: 'institution_name', type: 'varchar', length: 80, nullable: true })
  institutionName: string | null;

  /** Curso do aluno, texto livre de 2 a 120 caracteres (RN-08) */
  @Column({ type: 'varchar', length: 120, nullable: true })
  course: string | null;

  @Column({ name: 'created_by', nullable: true })
  createdBy: string;

  @Column({ name: 'updated_by', nullable: true })
  updatedBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
