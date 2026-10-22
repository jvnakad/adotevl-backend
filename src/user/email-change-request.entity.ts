import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, Index, Check } from 'typeorm';
import { User } from './user.entity';

/** Regras da troca do próprio e-mail que dependem do banco. Ver docs/db/troca-email.md. */
export const EMAIL_CHANGE_CODE_TTL_MINUTES = 5;
export const EMAIL_CHANGE_REQUEST_TTL_MINUTES = 30;
export const EMAIL_CHANGE_MAX_ATTEMPTS = 5;
export const EMAIL_CHANGE_COOLDOWN_SECONDS = 60;
export const EMAIL_CHANGE_MAX_PER_HOUR = 5;
export const EMAIL_CHANGE_MAX_PER_DAY = 10;
export const EMAIL_CHANGE_MAX_CODE_FAILURES_PER_DAY = 15;
export const EMAIL_CHANGE_CODE_LOCK_HOURS = 24;
export const EMAIL_CHANGE_MAX_PASSWORD_FAILURES_PER_HOUR = 5;
export const EMAIL_CHANGE_PASSWORD_LOCK_HOURS = 1;
export const EMAIL_CHANGE_RETENTION_DAYS = 7;

/**
 * Pedido de troca de e-mail do próprio usuário (código guardado só como hash bcrypt).
 * Uma linha = um envio de código: os limites por hora/dia e as falhas em 24 h são contados aqui.
 * Pendente = `closed_at IS NULL`; só um pendente por conta.
 */
@Entity('email_change_requests')
// Último pedido da conta, cooldown, envios em 1 h/24 h, falhas em 24 h e limpeza por conta
@Index('IDX_email_change_requests_user_created', ['userId', 'createdAt'])
// Só um pedido pendente por conta: o envio novo fecha o anterior na mesma transação
@Index('UQ_email_change_requests_user_open', ['userId'], { unique: true, where: '"closed_at" IS NULL' })
@Check('CHK_email_change_requests_attempts', `"attempts" >= 0 AND "attempts" <= 5`)
@Check('CHK_email_change_requests_hash', `char_length("code_hash") = 60`)
@Check('CHK_email_change_requests_expiry', `"expires_at" > "created_at" AND "request_expires_at" > "created_at"`)
@Check('CHK_email_change_requests_email', `"new_email" = lower("new_email")`)
@Check('CHK_email_change_requests_confirmed', `"confirmed_at" IS NULL OR "closed_at" IS NOT NULL`)
export class EmailChangeRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'FK_email_change_requests_user' })
  user: User;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  /** E-mail novo, normalizado (minúsculas). Só vira o e-mail da conta na confirmação */
  @Column({ name: 'new_email', type: 'varchar', length: 254 })
  newEmail: string;

  /** bcrypt (custo 10) do código; nunca o código em claro (o check de 60 caracteres barra isso) */
  @Column({ name: 'code_hash', type: 'varchar', length: 60 })
  codeHash: string;

  /** Validade do código: created_at + 5 min, gravada com o now() do banco */
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  /** Validade do pedido: 30 min a partir da senha conferida; o reenvio herda este valor */
  @Column({ name: 'request_expires_at', type: 'timestamptz' })
  requestExpiresAt: Date;

  /** Comparações feitas (contadas antes do bcrypt.compare); inclui a certa */
  @Column({ type: 'int', default: 0 })
  attempts: number;

  /** Código certo confirmado e e-mail trocado */
  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
  confirmedAt: Date | null;

  /** Pedido encerrado: confirmado, substituído, cancelado ou invalidado */
  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
