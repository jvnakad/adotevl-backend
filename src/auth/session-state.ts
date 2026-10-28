import { DataSource } from 'typeorm';
import { TeamSystemKey } from '../team/team.entity';

/**
 * Regra única de "a sessão do painel ainda vale?" (INV-1): guard HTTP, socket e renovação do refresh usam as mesmas peças.
 * Quem muda é só o marco de tempo e a precisão (access: segundo do `iat`; família: ms de `family_started_at`).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

// Query enxuta: o User tem profile/organization eager, e um findOne traria dois joins em toda rota autenticada.
// users."isActive" é camelCase no banco (a coluna não tem name:); volunteers e teams usam is_active
export const SESSION_STATE_FROM = `
    FROM users u
    LEFT JOIN volunteers v ON v.user_id = u.id AND v.is_active = true
    LEFT JOIN teams t      ON t.id = v.team_id AND t.is_active = true`;

/**
 * Guard e socket, em toda requisição: uma consulta só. Com `fid` ($2), o EXISTS é uma sonda no índice (family_id, revoked_at);
 * sem `fid` ($2 nulo) encerra antes do EXISTS. `r.user_id = u.id` amarra a família ao dono do token (SEC-09, §11.3).
 * O $2 precisa ser UUID válido ou nulo: valide com isUuid antes (texto inválido vira 22P02 e 500).
 */
export const SESSION_STATE_SQL = `
  SELECT u."isActive" AS "isActive", u.password_changed_at AS "passwordChangedAt", t.system_key AS "systemKey",
         ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM refresh_tokens r
                                       WHERE r.family_id = $2::uuid AND r.user_id = u.id AND r.revoked_at IS NULL)) AS "familyAlive"
  ${SESSION_STATE_FROM}
   WHERE u.id = $1`;

/** Só na renovação: o estado atual do usuário e os claims do access novo, sempre do banco (SEC-06). */
export const REFRESH_SUBJECT_SQL = `
  SELECT u.id AS "id", u."isActive" AS "isActive", u.is_confirmed AS "isConfirmed", u.is_approved AS "isApproved",
         u.password_changed_at AS "passwordChangedAt", t.system_key AS "systemKey",
         u.email AS "email", u.profile_id AS "profileId", u.organization_id AS "organizationId", p.name AS "profileName"
  ${SESSION_STATE_FROM}
    LEFT JOIN profiles p ON p.id = u.profile_id
   WHERE u.id = $1`;

export type SessionState = {
  isActive: boolean;
  passwordChangedAt: Date | null;
  systemKey: string | null;
  /** Só no SESSION_STATE_SQL com fid; ausente = não confere família */
  familyAlive?: boolean;
  /** Só no REFRESH_SUBJECT_SQL: o access não os tem hoje */
  isConfirmed?: boolean;
  isApproved?: boolean;
};

export type SessionRefusal = 'inexistente' | 'inativo' | 'nao_confirmado' | 'nao_aprovado' | 'volante' | 'senha_trocada' | 'familia_revogada';

/**
 * Domínio puro. `issuedAt` é o `iat` em segundos (`'second'`, access) ou o início da família em ms (`'ms'`, refresh).
 * - `'second'`: recusa `iat < floor(passwordChangedAt / 1000)`; o token assinado no mesmo segundo da troca vale (RN-29, RN-30).
 * - `'ms'`: recusa início da família < `passwordChangedAt`, no mesmo relógio do app (SEC-05).
 */
export function sessionRefusal(state: SessionState | undefined | null, issuedAt: number, precision: 'second' | 'ms'): SessionRefusal | null {
  if (!state) return 'inexistente';
  if (!state.isActive) return 'inativo';
  if (state.isConfirmed === false) return 'nao_confirmado';
  if (state.isApproved === false) return 'nao_aprovado';
  if (state.systemKey === TeamSystemKey.FLOATING_VOLUNTEER) return 'volante';
  if (state.passwordChangedAt) {
    const changedMs = new Date(state.passwordChangedAt).getTime();
    const stale = precision === 'second' ? issuedAt < Math.floor(changedMs / 1000) : issuedAt < changedMs;
    if (stale) return 'senha_trocada';
  }
  if (state.familyAlive === false) return 'familia_revogada';
  return null;
}

/**
 * Sessão do painel ainda vale? Sem claim scope, com sub e iat, `fid` (se vier) UUID de família viva do próprio usuário,
 * usuário ativo, fora da equipe volante e emitido a partir do segundo de password_changed_at (RN-12, RN-16, RN-21, RN-32).
 * Access sem `fid` (sessão legada de 8 h, link de aprovação) segue só a regra antiga. Fail-closed: `fid` malformado recusa.
 */
export async function isPanelSessionValid(dataSource: DataSource, payload: any): Promise<boolean> {
  if (!payload || payload.scope !== undefined || !payload.sub || typeof payload.iat !== 'number') return false;
  if (payload.fid !== undefined && !isUuid(payload.fid)) return false;
  const [state] = (await dataSource.query(SESSION_STATE_SQL, [payload.sub, payload.fid ?? null])) as SessionState[];
  return sessionRefusal(state, payload.iat, 'second') === null;
}
