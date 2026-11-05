import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, Index, Check } from 'typeorm';
import { User } from '../user/user.entity';

/** Regras do fluxo "Esqueci minha senha" que dependem do banco. Ver docs/db/esqueci-senha.md. */
export const PASSWORD_RESET_CODE_TTL_MINUTES = 5;
export const PASSWORD_RESET_MAX_ATTEMPTS = 5;
export const PASSWORD_RESET_COOLDOWN_SECONDS = 60;
export const PASSWORD_RESET_MAX_PER_HOUR = 5;
export const PASSWORD_RESET_MAX_PER_DAY = 10;
export const PASSWORD_RESET_MAX_FAILURES_PER_DAY = 15;
export const PASSWORD_RESET_LOCK_HOURS = 24;
export const PASSWORD_RESET_TOKEN_TTL_MINUTES = 10;
export const PASSWORD_RESET_RETENTION_DAYS = 7;

/**
 * Código de 6 dígitos do "Esqueci minha senha" (guardado só como hash bcrypt).
 * Uma linha = um envio: os limites por hora/dia e as falhas em 24 h são contados aqui.
 */
@Entity('password_reset_codes')
// Último código da conta, cooldown, envios em 1 h/24 h, falhas em 24 h e limpeza por conta
@Index('IDX_password_reset_codes_user_created', ['userId', 'createdAt'])
// Só um código em aberto por conta (RN-09): o envio novo fecha os anteriores na mesma transação
@Index('UQ_password_reset_codes_user_open', ['userId'], { unique: true, where: '"used_at" IS NULL' })
@Check('CHK_password_reset_codes_attempts', `"attempts" >= 0 AND "attempts" <= 5`)
@Check('CHK_password_reset_codes_hash', `char_length("code_hash") = 60`)
@Check('CHK_password_reset_codes_expiry', `"expires_at" > "created_at"`)
@Check('CHK_password_reset_codes_verified', `"verified_at" IS NULL OR "used_at" IS NOT NULL`)
@Check('CHK_password_reset_codes_reset', `"password_reset_at" IS NULL OR "verified_at" IS NOT NULL`)
export class PasswordResetCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'FK_password_reset_codes_user' })
  user: User;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  /** bcrypt (custo 10) do código; nunca o código em claro (o check de 60 caracteres barra isso) */
  @Column({ name: 'code_hash', type: 'varchar', length: 60 })
  codeHash: string;

  /** created_at + 5 min, gravado com o now() do banco */
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  /** Comparações feitas (contadas antes do bcrypt.compare, RN-38); inclui a certa */
  @Column({ type: 'int', default: 0 })
  attempts: number;

  /** Fechado: validado, substituído por envio novo ou invalidado na troca de senha */
  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  /** Código certo validado; o token de redefinição foi emitido a partir daqui (RN-39) */
  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt: Date | null;

  /** Senha trocada com o token deste código; uso único do token (RN-16) */
  @Column({ name: 'password_reset_at', type: 'timestamptz', nullable: true })
  passwordResetAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
