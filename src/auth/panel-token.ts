import { jwtSecret } from './jwt-secret';

const DEFAULT_ACCESS_TTL = '15m';
const MAX_ACCESS_TTL_SECONDS = 60 * 60;
const TTL_FORMAT = /^([1-9]\d{0,5})([sm])$/;

/**
 * Validade do access token do painel, em segundos (env `ACCESS_TOKEN_TTL`, padrão `15m`).
 * Só `<n>s` ou `<n>m`, no máximo 60 min; qualquer outra coisa derruba o boot (RN-01, SEC-06).
 * Lida a cada chamada, para o e2e poder ligar `1m`.
 */
export function accessTokenTtl(): number {
  const raw = process.env.ACCESS_TOKEN_TTL?.trim() || DEFAULT_ACCESS_TTL;
  const match = TTL_FORMAT.exec(raw);
  const seconds = match ? Number(match[1]) * (match[2] === 'm' ? 60 : 1) : NaN;
  // Nunca inclui o valor na mensagem
  if (!(seconds > 0) || seconds > MAX_ACCESS_TTL_SECONDS) throw new Error('ACCESS_TOKEN_TTL inválido.');
  return seconds;
}

/**
 * Opções do JwtModule: o padrão do módulo é o access curto, então um `sign` sem `expiresIn` nunca emite 8 h por esquecimento (SEC-06, §11.3).
 * Só a aprovação passa `APPROVAL_LINK_TTL`.
 */
export const panelJwtOptions = () => ({ secret: jwtSecret(), signOptions: { expiresIn: accessTokenTtl() } });

/** O link do e-mail de aprovação continua valendo 8 h, sem `fid` e sem refresh (RN-20, SEC-17). */
export const APPROVAL_LINK_TTL = '8h';

export type PanelTokenSubject = {
  id: string;
  email: string;
  profileId: string;
  profileName?: string;
  organizationId: string;
};

/**
 * Claims do access do painel, montados num lugar só e sempre a partir da linha do usuário no banco (RN-14, SEC-06).
 * Nunca leva `scope`: ele marca token de outro uso (agenda, redefinição) e o guard o recusa como sessão.
 */
export function panelTokenPayload(subject: PanelTokenSubject, familyId?: string) {
  return {
    sub: subject.id,
    email: subject.email,
    profileId: subject.profileId,
    profileName: subject.profileName,
    organizationId: subject.organizationId,
    ...(familyId ? { fid: familyId } : {}),
  };
}

/** Único ponto que converte um `User` (com `profile` carregado) nos dados do token do painel. */
export const panelTokenSubjectOf = (user: { id: string; email: string; profileId: string; profile?: { name?: string } | null; organizationId: string }): PanelTokenSubject => ({
  id: user.id,
  email: user.email,
  profileId: user.profileId,
  profileName: user.profile?.name,
  organizationId: user.organizationId,
});
