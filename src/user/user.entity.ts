import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Check,
} from 'typeorm';
import { Profile } from '../profile/profile.entity';
import { Organization } from '../organization/organization.entity';
import { ScheduleInstitution } from '../volunteer-schedule/schedule-institution.entity';

export interface TutorialProgress {
  tours: Record<string, number>;
  disabled: boolean;
}

// SET NULL ao excluir faculdade sem varrer users
@Index('IDX_users_institution', ['institutionId'], { where: '"institution_id" IS NOT NULL' })
@Check('CHK_users_course_length', `"course" IS NULL OR (char_length("course") >= 2 AND "course" = btrim("course"))`)
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'full_name' })
  fullName: string;

  @Column()
  cpf: string;

  @Column({ unique: true })
  email: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ name: 'birth_date', type: 'date', nullable: true })
  birthDate: Date;

  /** select: false: o hash nunca sai em consulta comum (RN-35). Login e troca de senha pedem com addSelect */
  @Column({ select: false })
  password: string;

  @Column({ name: 'is_confirmed', default: false })
  isConfirmed: boolean;

  @Column({ name: 'is_approved', default: false })
  isApproved: boolean;

  @Column({ name: 'confirmation_code', nullable: true, select: false })
  confirmationCode: string;

  /**
   * Última troca de senha (esqueci-senha, reset pela tela Voluntários, perfil) ou troca do e-mail pelo admin (revoga as sessões). JWT do painel com
   * iat < floor(passwordChangedAt / 1000) é recusado (RN-21). null = nunca trocou, nada revogado.
   * Gravar com o relógio da API (new Date()) e só depois assinar o token novo (RN-30).
   */
  @Column({ name: 'password_changed_at', type: 'timestamptz', nullable: true, select: false })
  passwordChangedAt: Date | null;

  /** Bloqueio do "Esqueci minha senha" após 15 falhas em 24 h (RN-31). Não afeta o login com a senha atual */
  @Column({ name: 'password_reset_locked_until', type: 'timestamptz', nullable: true, select: false })
  passwordResetLockedUntil: Date | null;

  @ManyToOne(() => Profile, { nullable: false, eager: true })
  @JoinColumn({ name: 'profile_id' })
  profile: Profile;

  @Column({ name: 'profile_id' })
  profileId: string;

  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'organization_id' })
  organizationId: string;

  /** Aceite LGPD no cadastro (uso dos dados para contato sobre voluntariado) */
  @Column({ name: 'consent_at', type: 'timestamptz', nullable: true })
  consentAt: Date | null;

  // Menor de idade (16-17): responsável obrigatório no cadastro
  @Column({ name: 'guardian_name', type: 'varchar', nullable: true })
  guardianName: string | null;

  @Column({ name: 'guardian_phone', type: 'varchar', nullable: true })
  guardianPhone: string | null;

  @Column({ name: 'guardian_consent_at', type: 'timestamptz', nullable: true })
  guardianConsentAt: Date | null;

  /** Tours do front já vistos (chave → versão) e desligamento geral; null = nunca viu nenhum */
  @Column({ name: 'tutorial_progress', type: 'jsonb', nullable: true })
  tutorialProgress: TutorialProgress | null;

  @Column({ default: true })
  isActive: boolean;

  /** Última faculdade usada na agenda (prefill RN-14). Pode estar inativa: o service devolve null nesse caso */
  @ManyToOne(() => ScheduleInstitution, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'institution_id', foreignKeyConstraintName: 'FK_users_schedule_institution' })
  institution: ScheduleInstitution | null;

  @Column({ name: 'institution_id', type: 'uuid', nullable: true })
  institutionId: string | null;

  /** Último curso usado na agenda (prefill RN-14). "Não" não apaga (RN-13) */
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
