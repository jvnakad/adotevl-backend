import { Logger } from '@nestjs/common';

const logger = new Logger('EmailChange');

export type EmailChangeCancelReason = 'usuario' | 'substituido' | 'troca_de_senha' | 'admin' | 'bloqueio' | 'email_em_uso';

/** Qualquer coisa com `query` (DataSource, EntityManager ou repositório.manager). */
type Queryable = { query: (sql: string, params?: unknown[]) => Promise<any> };

/**
 * Encerra o pedido de troca de e-mail pendente da conta e registra `email_change.cancelled`.
 * Usado pelo cancelamento, pela troca de senha e pela troca de e-mail feita pelo Admin (RN-14, RN-31).
 */
export async function closePendingEmailChange(db: Queryable, userId: string, reason: EmailChangeCancelReason) {
  const result = await db.query('UPDATE email_change_requests SET closed_at = now() WHERE user_id = $1 AND closed_at IS NULL RETURNING id', [userId]);
  const rows: { id: string }[] = Array.isArray(result?.[0]) ? result[0] : (result ?? []);
  for (const row of rows) logger.log(JSON.stringify({ event: 'email_change.cancelled', userId, requestId: row.id, reason }));
  return rows.length;
}

/**
 * Fecha os códigos de recuperação de senha abertos da conta: os não usados e os já validados cujo
 * `resetToken` ainda não gravou a senha. Usado quando o e-mail da conta muda (RN-20).
 */
export async function closeRecoveryCodes(db: Queryable, userId: string) {
  await db.query(
    `UPDATE password_reset_codes
        SET used_at = coalesce(used_at, now()),
            password_reset_at = CASE WHEN verified_at IS NOT NULL AND password_reset_at IS NULL THEN now() ELSE password_reset_at END
      WHERE user_id = $1 AND (used_at IS NULL OR (verified_at IS NOT NULL AND password_reset_at IS NULL))`,
    [userId],
  );
}
