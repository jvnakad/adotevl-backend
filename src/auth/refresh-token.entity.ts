import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, Index, Check } from 'typeorm';
import { User } from '../user/user.entity';

/** Regras da sessão do painel que dependem do banco. Ver docs/db/refresh-token.md. */
export const REFRESH_TOKEN_TTL_DAYS = 7;
export const REFRESH_FAMILY_MAX_AGE_DAYS = 30;
export const REFRESH_MAX_ACTIVE_FAMILIES = 10;
export const REFRESH_RETENTION_DAYS = 7;
/** Família iniciada há mais que teto + TTL + retenção (30 + 7 + 7) não pode ter ponta viva: a limpeza a apaga inteira (SEC-BUG-02) */
export const REFRESH_PURGE_FAMILY_AGE_DAYS = REFRESH_FAMILY_MAX_AGE_DAYS + REFRESH_TOKEN_TTL_DAYS + REFRESH_RETENTION_DAYS;

/**
 * Refresh token do painel, guardado só como HMAC-SHA256 hex (chave `${JWT_SECRET}:refresh`).
 * Uma família = uma sessão de um navegador (claim `fid` do access); cada renovação consome a linha e insere a próxima.
 * Só o RefreshTokenService escreve aqui. Tabela fora da Data API do Supabase (RLS + revoke, SEC-15).
 */
@Entity('refresh_tokens')
// Consumo, reuso e logout: a busca é sempre pelo hash (SEC-01)
@Index('UQ_refresh_tokens_token_hash', ['tokenHash'], { unique: true })
// EXISTS do guard/socket por requisição (fid vivo) e revogação da família
@Index('IDX_refresh_tokens_family_revoked', ['familyId', 'revokedAt'])
// Limite de 10 famílias ativas (RN-34) e sonda "sem ponta viva" da limpeza: pontas vivas do usuário em ordem de início
@Index('IDX_refresh_tokens_user_family_live', ['userId', 'familyStartedAt'], { where: '"used_at" IS NULL AND "revoked_at" IS NULL' })
// Uma ponta viva por família (SEC-03): duas renovações nunca deixam dois tokens válidos na mesma família
@Index('UQ_refresh_tokens_family_live', ['familyId'], { unique: true, where: '"used_at" IS NULL AND "revoked_at" IS NULL' })
// Limpeza por usuário no login e na renovação (lê todas as linhas do usuário, inclusive consumidas) e ON DELETE CASCADE de users
@Index('IDX_refresh_tokens_user', ['userId'])
@Check('CHK_refresh_tokens_hash', `char_length("token_hash") = 64`)
@Check('CHK_refresh_tokens_expiry', `"expires_at" > "created_at"`)
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'FK_refresh_tokens_user' })
  user: User;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  /** Id da família (claim `fid`); copiado da linha consumida em toda rotação */
  @Column({ name: 'family_id', type: 'uuid' })
  familyId: string;

  /** Início da família com o relógio do app (new Date()), o mesmo de password_changed_at; copiado na rotação */
  @Column({ name: 'family_started_at', type: 'timestamptz' })
  familyStartedAt: Date;

  /** HMAC-SHA256 hex do valor; nunca o valor em claro (o check de 64 caracteres barra isso) */
  @Column({ name: 'token_hash', type: 'varchar', length: 64 })
  tokenHash: string;

  /** now() do banco + 7 dias; só comparado com now() do banco */
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  /** Consumido na rotação (now() do banco) */
  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  /** Logout, reuso, recusa, teto ou limite de famílias (now() do banco) */
  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  /** Truncado em 255 no controller; fica só aqui, nunca no log (SEC-14) */
  @Column({ name: 'user_agent', type: 'varchar', length: 255, nullable: true })
  userAgent: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
