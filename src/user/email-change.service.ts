import { HttpException, HttpStatus, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { randomInt } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { User } from './user.entity';
import { MailService } from '../mail/mail.service';
import { RealtimeService } from '../realtime/realtime.service';
import { normalizeEmail } from '../common/validation/person';
import { RequestEmailChangeDto } from './dto/request-email-change.dto';
import {
  EMAIL_CHANGE_CODE_LOCK_HOURS,
  EMAIL_CHANGE_CODE_TTL_MINUTES,
  EMAIL_CHANGE_COOLDOWN_SECONDS,
  EMAIL_CHANGE_MAX_ATTEMPTS,
  EMAIL_CHANGE_MAX_CODE_FAILURES_PER_DAY,
  EMAIL_CHANGE_MAX_PASSWORD_FAILURES_PER_HOUR,
  EMAIL_CHANGE_MAX_PER_DAY,
  EMAIL_CHANGE_MAX_PER_HOUR,
  EMAIL_CHANGE_PASSWORD_LOCK_HOURS,
  EMAIL_CHANGE_REQUEST_TTL_MINUTES,
  EMAIL_CHANGE_RETENTION_DAYS,
} from './email-change-request.entity';
import { closePendingEmailChange, closeRecoveryCodes } from './email-change-pending';
import { affectedOf, rowsOf } from '../common/query-result';

export const EMAIL_CHANGE_MESSAGES = {
  sameEmail: 'Este já é o seu e-mail atual.',
  wrongPassword: 'Senha atual incorreta.',
  passwordLocked: 'Muitas tentativas com a senha errada. Tente de novo em 1 hora.',
  codeLocked: 'Muitas tentativas com código errado. A troca de e-mail fica bloqueada por 24 horas.',
  cooldown: 'Aguarde para pedir outro código.',
  hourlyLimit: 'Você atingiu o limite de códigos por hora. Tente de novo mais tarde.',
  dailyLimit: 'Você atingiu o limite de códigos de hoje. Tente de novo amanhã.',
  emailInUse: 'Este e-mail já está em uso.',
  emailTaken: 'Este e-mail passou a ser usado por outra conta. Escolha outro.',
  requestGone: 'Este pedido de troca não vale mais. Comece de novo.',
  codeExhausted: 'Muitas tentativas com este código. Peça um novo.',
  codeExpired: 'Este código expirou. Peça um novo.',
  completed: 'E-mail alterado. Entre de novo com o novo e-mail.',
  cancelled: 'Troca de e-mail cancelada.',
} as const;

const attemptsLeftMessage = (left: number) => `Código incorreto. Você ainda tem ${left} ${left === 1 ? 'tentativa' : 'tentativas'}.`;

const fail = (status: HttpStatus, code: string, message: string, extra: Record<string, unknown> = {}) => new HttpException({ statusCode: status, code, message, ...extra }, status);

type Block = { reason: 'bloqueio' | 'cooldown' | 'hora' | 'dia'; retryAfterSeconds?: number };
type RequestOutcome =
  | { kind: 'same' }
  | { kind: 'password_locked' }
  | { kind: 'wrong_password'; locked: boolean }
  | { kind: 'blocked'; block: Block }
  | { kind: 'in_use' }
  | { kind: 'sent'; requestId: string };
type CounterRow = { id: string; codeHash: string; attempts: number; newEmail: string };

/**
 * Troca do próprio e-mail pelo perfil: pedir → (reenviar) → confirmar com o código enviado ao e-mail novo (docs/specs/troca-email.md).
 * Limites, tentativas e consumo do pedido são condicionais no banco, com o relógio do Postgres, como em `PasswordResetService`.
 */
@Injectable()
export class EmailChangeService {
  private readonly logger = new Logger(EmailChangeService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly mailService: MailService,
    private readonly realtime: RealtimeService,
  ) {}

  async request(userId: string, dto: RequestEmailChangeDto, ip: string) {
    const newEmail = normalizeEmail(dto.newEmail) as string;
    // Hash antes da transação: o bcrypt não segura o lock da linha
    const { code, codeHash } = await this.newCode();

    const outcome = await this.dataSource.transaction(async (manager): Promise<RequestOutcome> => {
      // Trava por conta (RN-05): dois pedidos simultâneos não mandam dois e-mails
      const [user] = await manager.query('SELECT email, password FROM users WHERE id = $1 FOR NO KEY UPDATE', [userId]);
      if (!user) throw new UnauthorizedException('Token inválido ou expirado.');
      if (String(user.email).trim().toLowerCase() === newEmail) return { kind: 'same' };

      if (await this.hasRecentEvent(manager, userId, 'PASSWORD_LOCK', EMAIL_CHANGE_PASSWORD_LOCK_HOURS)) return { kind: 'password_locked' };

      if (!(await bcrypt.compare(dto.currentPassword, user.password))) {
        await manager.query(`INSERT INTO email_change_events (user_id, kind) VALUES ($1, 'PASSWORD_FAILED')`, [userId]);
        const [{ failures }] = await manager.query(
          `SELECT count(*)::int AS "failures" FROM email_change_events WHERE user_id = $1 AND kind = 'PASSWORD_FAILED' AND created_at > now() - ($2::int * interval '1 hour')`,
          [userId, EMAIL_CHANGE_PASSWORD_LOCK_HOURS],
        );
        const locked = failures >= EMAIL_CHANGE_MAX_PASSWORD_FAILURES_PER_HOUR;
        if (locked) await manager.query(`INSERT INTO email_change_events (user_id, kind) VALUES ($1, 'PASSWORD_LOCK')`, [userId]);
        return { kind: 'wrong_password', locked };
      }

      const block = await this.checkLimits(manager, userId);
      if (block) return { kind: 'blocked', block };

      const [taken] = await manager.query('SELECT 1 FROM users WHERE lower(email) = $1 AND id <> $2 LIMIT 1', [newEmail, userId]);
      if (taken) {
        // Conta nos limites por hora e por dia (RN-09), mas não abre cooldown
        await manager.query(`INSERT INTO email_change_events (user_id, kind) VALUES ($1, 'EMAIL_IN_USE')`, [userId]);
        return { kind: 'in_use' };
      }

      // Só o último pedido vale (RN-08)
      await closePendingEmailChange(manager, userId, 'substituido');
      const [row] = await manager.query(
        `INSERT INTO email_change_requests (user_id, new_email, code_hash, expires_at, request_expires_at)
         VALUES ($1, $2, $3, now() + ($4::int * interval '1 minute'), now() + ($5::int * interval '1 minute'))
         RETURNING id`,
        [userId, newEmail, codeHash, EMAIL_CHANGE_CODE_TTL_MINUTES, EMAIL_CHANGE_REQUEST_TTL_MINUTES],
      );
      return { kind: 'sent', requestId: row.id };
    });

    switch (outcome.kind) {
      case 'same':
        throw fail(HttpStatus.BAD_REQUEST, 'SAME_EMAIL', EMAIL_CHANGE_MESSAGES.sameEmail);
      case 'password_locked':
        this.log('email_change.blocked', { userId, reason: 'senha' }, 'warn');
        throw fail(HttpStatus.TOO_MANY_REQUESTS, 'PASSWORD_LOCKED', EMAIL_CHANGE_MESSAGES.passwordLocked);
      case 'wrong_password':
        this.log(outcome.locked ? 'email_change.password_locked' : 'email_change.password_failed', { userId, ip }, 'warn');
        throw fail(HttpStatus.BAD_REQUEST, 'WRONG_PASSWORD', EMAIL_CHANGE_MESSAGES.wrongPassword);
      case 'blocked':
        throw this.blockedError(userId, outcome.block);
      case 'in_use':
        this.log('email_change.email_in_use', { userId });
        throw fail(HttpStatus.CONFLICT, 'EMAIL_IN_USE', EMAIL_CHANGE_MESSAGES.emailInUse);
    }

    this.log('email_change.requested', { userId, requestId: outcome.requestId, emailDomain: newEmail.split('@')[1], ip });
    await this.sendCode(newEmail, code);
    await this.cleanup();
    return { message: `Enviamos um código para ${newEmail}.`, newEmail, resendInSeconds: EMAIL_CHANGE_COOLDOWN_SECONDS };
  }

  async resend(userId: string) {
    const { code, codeHash } = await this.newCode();

    const outcome = await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT id FROM users WHERE id = $1 FOR NO KEY UPDATE', [userId]);
      if (await this.hasRecentEvent(manager, userId, 'CODE_LOCK', EMAIL_CHANGE_CODE_LOCK_HOURS)) return { block: { reason: 'bloqueio' } as Block };

      const [pending] = await manager.query(
        `SELECT id, new_email AS "newEmail", request_expires_at AS "requestExpiresAt"
           FROM email_change_requests WHERE user_id = $1 AND closed_at IS NULL AND request_expires_at > now()`,
        [userId],
      );
      if (!pending) return { gone: true };

      const block = await this.checkLimits(manager, userId);
      if (block) return { block };

      await closePendingEmailChange(manager, userId, 'substituido');
      const [row] = await manager.query(
        `INSERT INTO email_change_requests (user_id, new_email, code_hash, expires_at, request_expires_at)
         VALUES ($1, $2, $3, now() + ($4::int * interval '1 minute'), $5)
         RETURNING id`,
        [userId, pending.newEmail, codeHash, EMAIL_CHANGE_CODE_TTL_MINUTES, pending.requestExpiresAt],
      );
      return { requestId: row.id as string, newEmail: pending.newEmail as string };
    });

    if ('block' in outcome) throw this.blockedError(userId, outcome.block);
    if ('gone' in outcome) throw fail(HttpStatus.GONE, 'REQUEST_GONE', EMAIL_CHANGE_MESSAGES.requestGone);

    this.log('email_change.resent', { userId, requestId: outcome.requestId });
    await this.sendCode(outcome.newEmail, code);
    await this.cleanup();
    return { message: `Enviamos um novo código para ${outcome.newEmail}.`, newEmail: outcome.newEmail, resendInSeconds: EMAIL_CHANGE_COOLDOWN_SECONDS };
  }

  async confirm(userId: string, code: string, ip: string) {
    // Tentativa contada antes do compare, de forma atômica (RN-15)
    const counted = await this.countAttempt(userId);
    if (!counted) throw await this.explainRejection(userId);

    if (!(await bcrypt.compare(code, counted.codeHash))) {
      const attemptsLeft = EMAIL_CHANGE_MAX_ATTEMPTS - counted.attempts;
      this.log('email_change.verify_failed', { userId, requestId: counted.id, attempts: counted.attempts }, 'warn');
      if (await this.lockOnFailures(userId)) {
        this.log('email_change.locked', { userId, requestId: counted.id, attempts: counted.attempts }, 'warn');
        throw fail(HttpStatus.TOO_MANY_REQUESTS, 'CODE_LOCKED', EMAIL_CHANGE_MESSAGES.codeLocked);
      }
      if (attemptsLeft <= 0) throw fail(HttpStatus.BAD_REQUEST, 'CODE_EXHAUSTED', EMAIL_CHANGE_MESSAGES.codeExhausted);
      throw fail(HttpStatus.BAD_REQUEST, 'CODE_INVALID', attemptsLeftMessage(attemptsLeft), { attemptsLeft });
    }

    let outcome: 'done' | 'gone' | 'in_use';
    try {
      outcome = await this.dataSource.transaction((manager) => this.applyChange(manager, userId, counted));
    } catch (error) {
      // Outra conta confirmou o mesmo e-mail primeiro: o índice único barra (RN-18)
      if ((error as { code?: string }).code !== '23505') throw error;
      outcome = 'in_use';
      await closePendingEmailChange(this.dataSource, userId, 'email_em_uso');
    }

    if (outcome === 'gone') throw fail(HttpStatus.GONE, 'REQUEST_GONE', EMAIL_CHANGE_MESSAGES.requestGone);
    if (outcome === 'in_use') throw fail(HttpStatus.CONFLICT, 'EMAIL_IN_USE', EMAIL_CHANGE_MESSAGES.emailTaken);

    await this.realtime.disconnectUser(userId);
    this.log('email_change.completed', { userId, requestId: counted.id, ip });
    return { message: EMAIL_CHANGE_MESSAGES.completed };
  }

  /** Idempotente: sem pedido pendente também responde sucesso (RN-23). */
  async cancel(userId: string) {
    await closePendingEmailChange(this.dataSource, userId, 'usuario');
    return { message: EMAIL_CHANGE_MESSAGES.cancelled };
  }

  /** Troca atômica (RN-17), com a linha do usuário travada. */
  private async applyChange(manager: EntityManager, userId: string, counted: CounterRow): Promise<'done' | 'gone' | 'in_use'> {
    await manager.query('SELECT id FROM users WHERE id = $1 FOR NO KEY UPDATE', [userId]);

    const [taken] = await manager.query('SELECT 1 FROM users WHERE lower(email) = $1 AND id <> $2 LIMIT 1', [counted.newEmail, userId]);
    if (taken) {
      await manager.query('UPDATE email_change_requests SET closed_at = now() WHERE id = $1 AND closed_at IS NULL', [counted.id]);
      return 'in_use';
    }

    // Consumo condicional: duas confirmações simultâneas geram no máximo 1 troca
    const consumed = await manager.query('UPDATE email_change_requests SET confirmed_at = now(), closed_at = now() WHERE id = $1 AND closed_at IS NULL AND confirmed_at IS NULL', [counted.id]);
    if (!affectedOf(consumed)) return 'gone';

    // passwordChangedAt é o marco de revogação de sessões do JwtAuthGuard (RN-19)
    await manager.update(User, { id: userId }, { email: counted.newEmail, updatedBy: userId, passwordChangedAt: new Date() });
    // Recuperação de senha aberta: códigos não usados e tokens de redefinição já emitidos (RN-20)
    await closeRecoveryCodes(manager, userId);
    // Agenda da LP: o código aberto era para o e-mail antigo; a sessão cai pelo marco acima (P-01)
    await manager.query('UPDATE schedule_access_codes SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [userId]);
    await closePendingEmailChange(manager, userId, 'substituido');
    return 'done';
  }

  /** Cooldown, bloqueio por código errado, limite por hora e por dia (RN-10, RN-11, RN-13). Chamar com a linha do usuário travada. */
  private async checkLimits(manager: EntityManager, userId: string): Promise<Block | null> {
    if (await this.hasRecentEvent(manager, userId, 'CODE_LOCK', EMAIL_CHANGE_CODE_LOCK_HOURS)) return { reason: 'bloqueio' };

    const [last] = await manager.query(
      `SELECT ceil(extract(epoch FROM (max(created_at) + ($2::int * interval '1 second') - now())))::int AS "retryAfter"
         FROM email_change_requests WHERE user_id = $1 AND created_at > now() - ($2::int * interval '1 second')`,
      [userId, EMAIL_CHANGE_COOLDOWN_SECONDS],
    );
    // Dentro do cooldown não fecha o pedido atual (RN-10)
    if (last?.retryAfter > 0) return { reason: 'cooldown', retryAfterSeconds: Math.min(last.retryAfter, EMAIL_CHANGE_COOLDOWN_SECONDS) };

    const [window] = await manager.query(
      `SELECT count(*) FILTER (WHERE at > now() - interval '1 hour')::int AS "lastHour", count(*)::int AS "lastDay"
         FROM (SELECT created_at AS at FROM email_change_requests WHERE user_id = $1 AND created_at > now() - interval '24 hours'
               UNION ALL
               SELECT created_at FROM email_change_events WHERE user_id = $1 AND kind = 'EMAIL_IN_USE' AND created_at > now() - interval '24 hours') sends`,
      [userId],
    );
    if (window.lastHour >= EMAIL_CHANGE_MAX_PER_HOUR) return { reason: 'hora' };
    if (window.lastDay >= EMAIL_CHANGE_MAX_PER_DAY) return { reason: 'dia' };
    return null;
  }

  private blockedError(userId: string, block: Block) {
    this.log('email_change.blocked', { userId, reason: block.reason }, 'warn');
    switch (block.reason) {
      case 'bloqueio':
        return fail(HttpStatus.TOO_MANY_REQUESTS, 'CODE_LOCKED', EMAIL_CHANGE_MESSAGES.codeLocked);
      case 'cooldown':
        return fail(HttpStatus.TOO_MANY_REQUESTS, 'COOLDOWN', EMAIL_CHANGE_MESSAGES.cooldown, { retryAfterSeconds: block.retryAfterSeconds });
      case 'hora':
        return fail(HttpStatus.TOO_MANY_REQUESTS, 'HOURLY_LIMIT', EMAIL_CHANGE_MESSAGES.hourlyLimit);
      default:
        return fail(HttpStatus.TOO_MANY_REQUESTS, 'DAILY_LIMIT', EMAIL_CHANGE_MESSAGES.dailyLimit);
    }
  }

  /** Tentativa contada antes do compare; conta bloqueada, código vencido ou esgotado não passam (RN-15). */
  private async countAttempt(userId: string): Promise<CounterRow | null> {
    const result = await this.dataSource.query(
      `UPDATE email_change_requests r SET attempts = r.attempts + 1
        WHERE r.user_id = $1 AND r.closed_at IS NULL
          AND r.request_expires_at > now() AND r.expires_at > now() AND r.attempts < $2
          AND NOT EXISTS (SELECT 1 FROM email_change_events e WHERE e.user_id = $1 AND e.kind = 'CODE_LOCK' AND e.created_at > now() - ($3::int * interval '1 hour'))
        RETURNING r.id AS "id", r.code_hash AS "codeHash", r.attempts AS "attempts", r.new_email AS "newEmail"`,
      [userId, EMAIL_CHANGE_MAX_ATTEMPTS, EMAIL_CHANGE_CODE_LOCK_HOURS],
    );
    return rowsOf<CounterRow>(result)[0] ?? null;
  }

  /** Por que a tentativa não foi contada: a resposta é explícita porque o pedido é da própria conta (D-09). */
  private async explainRejection(userId: string) {
    if (await this.hasRecentEvent(this.dataSource, userId, 'CODE_LOCK', EMAIL_CHANGE_CODE_LOCK_HOURS)) {
      return fail(HttpStatus.TOO_MANY_REQUESTS, 'CODE_LOCKED', EMAIL_CHANGE_MESSAGES.codeLocked);
    }
    const [pending] = await this.dataSource.query(
      `SELECT attempts, request_expires_at <= now() AS "requestExpired", expires_at <= now() AS "codeExpired" FROM email_change_requests WHERE user_id = $1 AND closed_at IS NULL`,
      [userId],
    );
    if (!pending || pending.requestExpired) return fail(HttpStatus.GONE, 'REQUEST_GONE', EMAIL_CHANGE_MESSAGES.requestGone);
    if (pending.codeExpired) return fail(HttpStatus.BAD_REQUEST, 'CODE_EXPIRED', EMAIL_CHANGE_MESSAGES.codeExpired);
    if (pending.attempts >= EMAIL_CHANGE_MAX_ATTEMPTS) return fail(HttpStatus.BAD_REQUEST, 'CODE_EXHAUSTED', EMAIL_CHANGE_MESSAGES.codeExhausted);
    // Encerrado entre a contagem e a leitura (outra aba)
    return fail(HttpStatus.GONE, 'REQUEST_GONE', EMAIL_CHANGE_MESSAGES.requestGone);
  }

  /** Código errado: se a conta chegou a 15 falhas em 24 h, bloqueia por 24 h e encerra o pedido (RN-13). */
  private async lockOnFailures(userId: string) {
    const locked = await this.dataSource.query(
      `INSERT INTO email_change_events (user_id, kind)
       SELECT $1, 'CODE_LOCK'
        WHERE NOT EXISTS (SELECT 1 FROM email_change_events WHERE user_id = $1 AND kind = 'CODE_LOCK' AND created_at > now() - ($3::int * interval '1 hour'))
          AND (SELECT coalesce(sum(attempts - (confirmed_at IS NOT NULL)::int), 0) FROM email_change_requests
                WHERE user_id = $1 AND created_at > now() - interval '24 hours') >= $2
       RETURNING id`,
      [userId, EMAIL_CHANGE_MAX_CODE_FAILURES_PER_DAY, EMAIL_CHANGE_CODE_LOCK_HOURS],
    );
    if (!rowsOf(locked).length) return false;
    await closePendingEmailChange(this.dataSource, userId, 'bloqueio');
    return true;
  }

  private async hasRecentEvent(db: { query: DataSource['query'] }, userId: string, kind: string, hours: number) {
    const rows = await db.query(`SELECT 1 FROM email_change_events WHERE user_id = $1 AND kind = $2 AND created_at > now() - ($3::int * interval '1 hour') LIMIT 1`, [userId, kind, hours]);
    return rows.length > 0;
  }

  private async newCode() {
    // RN-08: randomInt (CSPRNG) com zeros à esquerda; só o hash é gravado
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    return { code, codeHash: await bcrypt.hash(code, 10) };
  }

  /** Depois do commit: falha de envio não desfaz o pedido, que continua contando no limite. Nada do código nem do endereço vai para o log. */
  private async sendCode(to: string, code: string) {
    try {
      await this.mailService.sendEmailChangeCodeEmail(to, code);
    } catch (error) {
      const message = String((error as Error).message ?? '').split(code).join('******').split(to).join('***');
      this.logger.error(`Falha ao enviar o código da troca de e-mail: ${message}`);
    }
  }

  /** Retenção de 7 dias. Falha só vai para o log. */
  private async cleanup() {
    try {
      await this.dataSource.query(`DELETE FROM email_change_requests WHERE created_at < now() - ($1::int * interval '1 day')`, [EMAIL_CHANGE_RETENTION_DAYS]);
      await this.dataSource.query(`DELETE FROM email_change_events WHERE created_at < now() - ($1::int * interval '1 day')`, [EMAIL_CHANGE_RETENTION_DAYS]);
    } catch (error) {
      this.logger.error(`Falha na limpeza dos pedidos de troca de e-mail: ${(error as Error).message}`);
    }
  }

  /** Log de segurança estruturado: nunca código, senha, token nem e-mail em claro. */
  private log(event: string, fields: Record<string, unknown>, level: 'log' | 'warn' = 'log') {
    this.logger[level](JSON.stringify({ event, ...fields }));
  }
}
