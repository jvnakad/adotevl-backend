import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHmac, randomBytes, randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { RealtimeService } from '../realtime/realtime.service';
import { affectedOf, rowsOf } from '../common/query-result';
import { jwtSecret } from './jwt-secret';
import { PanelTokenSubject, panelTokenPayload } from './panel-token';
import {
  REFRESH_FAMILY_MAX_AGE_DAYS,
  REFRESH_MAX_ACTIVE_FAMILIES,
  REFRESH_PURGE_FAMILY_AGE_DAYS,
  REFRESH_RETENTION_DAYS,
  REFRESH_TOKEN_TTL_DAYS,
} from './refresh-token.entity';
import { REFRESH_SUBJECT_SQL, SessionRefusal, SessionState, sessionRefusal } from './session-state';

/** Uma mensagem só para toda recusa da renovação: o motivo vai só para o log (SEC-13, INV-8). */
export const SESSION_EXPIRED_MESSAGE = 'Sessão expirada. Faça login novamente.';

export type SessionPair = { access_token: string; refresh_token: string };

const DAY_MS = 86_400_000;
const USER_AGENT_MAX = 255;

type RefusalReason = SessionRefusal | 'expirado' | 'revogado' | 'teto' | 'reuso';

type Rotation =
  | { kind: 'ok'; userId: string; familyId: string; refresh: string; subject: PanelTokenSubject }
  | { kind: 'refused'; reason: RefusalReason; userId?: string; familyId?: string; revoked: boolean };

/**
 * Limpeza (Q7 no login com `$4 = NULL`, Q8 na renovação com `$4` = família que acabou de rotacionar). SEC-BUG-02, docs/db/refresh-token.md §5.6.
 * Uma família só sai inteira, e só quando não pode mais estar viva: sem ponta viva e morta há mais de 7 dias, ou iniciada há mais de 44 dias.
 * O `user_id = $1` dentro dos dois NOT EXISTS é de propósito: sem ele o planner faz Seq Scan em refresh_tokens.
 * $1 user_id | $2 REFRESH_RETENTION_DAYS | $3 Date do app (início da família mais velha que pode ter ponta viva) | $4 família a poupar ou NULL.
 */
export const REFRESH_CLEANUP_SQL = `
DELETE FROM refresh_tokens r
 WHERE r.user_id = $1
   AND ($4::uuid IS NULL OR r.family_id <> $4::uuid)
   AND (    r.family_started_at < $3::timestamptz
        OR (    LEAST(r.revoked_at, r.expires_at) < now() - ($2::int * interval '1 day')
            AND NOT EXISTS (SELECT 1 FROM refresh_tokens p
                             WHERE p.user_id = $1
                               AND p.family_id = r.family_id
                               AND p.used_at IS NULL AND p.revoked_at IS NULL AND p.expires_at > now())
            AND NOT EXISTS (SELECT 1 FROM refresh_tokens d
                             WHERE d.user_id = $1
                               AND d.family_id = r.family_id
                               AND LEAST(d.revoked_at, d.expires_at) >= now() - ($2::int * interval '1 day'))))`;

const INSERT_TOKEN_SQL = `
  INSERT INTO refresh_tokens (user_id, family_id, family_started_at, token_hash, expires_at, user_agent)
  VALUES ($1, $2, $3, $4, now() + ($5::int * interval '1 day'), $6)`;

// Q1: consumo atômico; o lock da linha faz a 2ª chamada simultânea cair em reuso (RN-09)
const CONSUME_SQL = `
  UPDATE refresh_tokens SET used_at = now()
   WHERE token_hash = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
  RETURNING user_id AS "userId", family_id AS "familyId", family_started_at AS "familyStartedAt"`;

// Q2: classificação pelo hash quando o consumo não pegou nenhuma linha
const CLASSIFY_SQL = `SELECT user_id AS "userId", family_id AS "familyId", used_at AS "usedAt", revoked_at AS "revokedAt" FROM refresh_tokens WHERE token_hash = $1`;

// Q5: revoga a família toda (sem filtrar por expires_at)
const REVOKE_FAMILY_SQL = `UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`;

// Q6: logout, um comando só
const LOGOUT_SQL = `
  UPDATE refresh_tokens SET revoked_at = now()
   WHERE family_id = (SELECT family_id FROM refresh_tokens WHERE token_hash = $1)
     AND revoked_at IS NULL
  RETURNING user_id AS "userId", family_id AS "familyId"`;

// Q4: limite de famílias ativas (conta a recém-inserida); devolve as expulsas
const EVICT_FAMILIES_SQL = `
  UPDATE refresh_tokens SET revoked_at = now()
   WHERE revoked_at IS NULL
     AND family_id IN (SELECT family_id FROM refresh_tokens
                        WHERE user_id = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
                        ORDER BY family_started_at DESC OFFSET $2::int)
  RETURNING family_id AS "familyId"`;

/** Valor entregue ao cliente: 32 bytes CSPRNG em base64url = 43 caracteres (SEC-01). */
export const newRefreshValue = () => randomBytes(32).toString('base64url');

/** O que vai para a coluna: HMAC-SHA256 hex com chave derivada do JWT_SECRET (SEC-02). Girar o segredo derruba todos os refresh. */
export const hashRefresh = (raw: string) => createHmac('sha256', `${jwtSecret()}:refresh`).update(raw).digest('hex');

const truncateUserAgent = (userAgent?: string) => (userAgent ? userAgent.slice(0, USER_AGENT_MAX) : null);

type SubjectRow = SessionState & PanelTokenSubject;

/**
 * Sessão do painel: emite, rotaciona e revoga o par access/refresh (docs/arch/refresh-token.md §2.2). Único que assina o access do painel.
 * Só ele escreve em `refresh_tokens`. O refresh é guardado e buscado só pelo HMAC; a rotação herda a família da linha consumida (INV-3, INV-4).
 */
@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly jwtService: JwtService,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Abre uma família nova (login ou troca de senha pelo perfil). Chamar DEPOIS de gravar `password_changed_at` (RN-06):
   * o início da família usa o mesmo relógio e passa no `>=`.
   */
  async issue(subject: PanelTokenSubject, userAgent?: string): Promise<SessionPair> {
    const refresh = newRefreshValue();
    const familyId = randomUUID();
    const startedAt = new Date();

    const evicted = await this.dataSource.transaction(async (manager) => {
      // Serializa logins simultâneos do mesmo usuário: o limite de famílias não escapa por corrida
      await manager.query('SELECT 1 FROM users WHERE id = $1 FOR NO KEY UPDATE', [subject.id]);
      await manager.query(INSERT_TOKEN_SQL, [subject.id, familyId, startedAt, hashRefresh(refresh), REFRESH_TOKEN_TTL_DAYS, truncateUserAgent(userAgent)]);
      const rows = rowsOf<{ familyId: string }>(await manager.query(EVICT_FAMILIES_SQL, [subject.id, REFRESH_MAX_ACTIVE_FAMILIES]));
      return [...new Set(rows.map((row) => row.familyId))];
    });

    this.log('auth.refresh_issued', { userId: subject.id, familyId });
    for (const evictedId of evicted) {
      this.log('auth.refresh_family_evicted', { userId: subject.id, familyId: evictedId }, 'warn');
      await this.realtime.disconnectFamily(evictedId);
    }
    await this.cleanup(subject.id, null);
    return { access_token: this.jwtService.sign(panelTokenPayload(subject, familyId)), refresh_token: refresh };
  }

  /** Troca o refresh por um par novo da mesma família. Toda recusa lança o mesmo 401, depois de gravar a revogação (A-05). */
  async rotate(rawRefresh: string, ctx: { userAgent?: string; ip?: string } = {}): Promise<SessionPair> {
    const hash = hashRefresh(rawRefresh);
    const next = newRefreshValue();

    // O 401 sai depois do commit: lançar de dentro desfaria a revogação
    const outcome = await this.dataSource.transaction((manager) => this.rotateInTransaction(manager, hash, next, ctx.userAgent));

    if (outcome.kind === 'refused') {
      if (outcome.reason === 'reuso') {
        this.log('auth.refresh_reuse', { userId: outcome.userId, familyId: outcome.familyId, ip: ctx.ip }, 'warn');
      } else {
        this.log('auth.refresh_rejected', { userId: outcome.userId, familyId: outcome.familyId, ip: ctx.ip, motivo: outcome.reason }, 'warn');
      }
      if (outcome.revoked && outcome.familyId) await this.realtime.disconnectFamily(outcome.familyId);
      throw new UnauthorizedException(SESSION_EXPIRED_MESSAGE);
    }

    this.log('auth.refresh_rotated', { userId: outcome.userId, familyId: outcome.familyId });
    await this.cleanup(outcome.userId, outcome.familyId);
    return { access_token: this.jwtService.sign(panelTokenPayload(outcome.subject, outcome.familyId)), refresh_token: outcome.refresh };
  }

  /** Logout: revoga a família do refresh informado. Idempotente: token desconhecido, vencido, consumido ou já revogado não lança nem loga. */
  async revokeFamily(rawRefresh: string): Promise<void> {
    const [revoked] = rowsOf<{ userId: string; familyId: string }>(await this.dataSource.query(LOGOUT_SQL, [hashRefresh(rawRefresh)]));
    if (!revoked) return;
    this.log('auth.logout', { userId: revoked.userId, familyId: revoked.familyId });
    await this.realtime.disconnectFamily(revoked.familyId);
  }

  private async rotateInTransaction(manager: EntityManager, hash: string, next: string, userAgent?: string): Promise<Rotation> {
    const consumed = rowsOf<{ userId: string; familyId: string; familyStartedAt: Date }>(await manager.query(CONSUME_SQL, [hash]))[0];

    if (!consumed) {
      const found = rowsOf<{ userId: string; familyId: string; usedAt: Date | null; revokedAt: Date | null }>(await manager.query(CLASSIFY_SQL, [hash]))[0];
      if (!found) return { kind: 'refused', reason: 'inexistente', revoked: false };
      const { userId, familyId } = found;
      // Reuso tem precedência sobre a expiração: consumido ou revogado revoga a família mesmo vencido (SEC-04)
      if (found.usedAt) {
        await this.revoke(manager, familyId);
        return { kind: 'refused', reason: 'reuso', userId, familyId, revoked: true };
      }
      if (found.revokedAt) {
        const revoked = await this.revoke(manager, familyId);
        return { kind: 'refused', reason: 'revogado', userId, familyId, revoked };
      }
      // Vencido e nunca consumido: não é prova de roubo, nada é revogado
      return { kind: 'refused', reason: 'expirado', userId, familyId, revoked: false };
    }

    const { userId, familyId } = consumed;
    const startedMs = new Date(consumed.familyStartedAt).getTime();

    const reject = async (reason: RefusalReason): Promise<Rotation> => {
      await this.revoke(manager, familyId);
      return { kind: 'refused', reason, userId, familyId, revoked: true };
    };

    // Teto absoluto de 30 dias desde o início da família, no relógio do app (RN-03, SEC-12)
    if (Date.now() - startedMs >= REFRESH_FAMILY_MAX_AGE_DAYS * DAY_MS) return reject('teto');

    const subject = rowsOf<SubjectRow>(await manager.query(REFRESH_SUBJECT_SQL, [userId]))[0];
    // Mesma regra do guard e do socket; aqui a precisão é o ms do início da família (SEC-05)
    const refusal = sessionRefusal(subject, startedMs, 'ms');
    if (refusal) return reject(refusal);

    // Consome antes de inserir: o índice único da ponta viva (UQ_refresh_tokens_family_live) barra o contrário
    await manager.query(INSERT_TOKEN_SQL, [userId, familyId, consumed.familyStartedAt, hashRefresh(next), REFRESH_TOKEN_TTL_DAYS, truncateUserAgent(userAgent)]);
    return {
      kind: 'ok',
      userId,
      familyId,
      refresh: next,
      subject: { id: subject.id, email: subject.email, profileId: subject.profileId, profileName: subject.profileName, organizationId: subject.organizationId },
    };
  }

  private async revoke(manager: EntityManager, familyId: string): Promise<boolean> {
    return affectedOf(await manager.query(REVOKE_FAMILY_SQL, [familyId])) > 0;
  }

  /** Best effort, depois do commit: falha só vai para o log (padrão do PasswordResetService). */
  private async cleanup(userId: string, keepFamilyId: string | null) {
    try {
      const purgeBefore = new Date(Date.now() - REFRESH_PURGE_FAMILY_AGE_DAYS * DAY_MS);
      await this.dataSource.query(REFRESH_CLEANUP_SQL, [userId, REFRESH_RETENTION_DAYS, purgeBefore, keepFamilyId]);
    } catch (error) {
      this.logger.error(`Falha na limpeza dos refresh tokens: ${(error as Error).message}`);
    }
  }

  /** Log de segurança estruturado: só ids, motivo e IP onde a tabela permite. Nunca refresh, hash, access nem User-Agent (SEC-14). */
  private log(event: string, fields: Record<string, unknown>, level: 'log' | 'warn' = 'log') {
    this.logger[level](JSON.stringify({ event, ...fields }));
  }
}
