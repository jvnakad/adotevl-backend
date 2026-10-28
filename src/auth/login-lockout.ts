/**
 * Bloqueio temporário do login por conta (e-mail), independente do IP: o throttle por IP não basta contra
 * força bruta distribuída. Após MAX_FAILURES falhas dentro da janela, a conta recusa qualquer tentativa
 * (inclusive com a senha certa) por LOCK_MS.
 *
 * Em memória (como o cooldown de reenvio da confirmação): vale por instância da API e zera no restart.
 * Com várias instâncias o limite efetivo é MAX_FAILURES por instância; em produção há uma só (Railway).
 * Chaveia pelo e-mail informado, exista a conta ou não, para não revelar quais e-mails existem.
 * Efeito colateral aceito: quem erra a senha de propósito pode travar a conta de outra pessoa por LOCK_MS.
 */
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60_000;
export const LOGIN_LOCK_MS = 15 * 60_000;
const MAX_TRACKED = 10_000;

interface Entry {
  failures: number;
  firstAt: number;
  lockedUntil: number;
}

export class LoginLockout {
  private readonly entries = new Map<string, Entry>();

  private key(email: string) {
    return String(email ?? '').trim().toLowerCase();
  }

  /** Segundos restantes de bloqueio (0 = liberado). */
  retryAfterSeconds(email: string, now = Date.now()): number {
    const entry = this.entries.get(this.key(email));
    if (!entry || entry.lockedUntil <= now) return 0;
    return Math.ceil((entry.lockedUntil - now) / 1000);
  }

  recordFailure(email: string, now = Date.now()) {
    const key = this.key(email);
    let entry = this.entries.get(key);
    if (!entry || now - entry.firstAt > LOGIN_FAILURE_WINDOW_MS || (entry.lockedUntil && entry.lockedUntil <= now)) {
      this.prune(now);
      entry = { failures: 0, firstAt: now, lockedUntil: 0 };
    }
    entry.failures += 1;
    if (entry.failures >= LOGIN_MAX_FAILURES) entry.lockedUntil = now + LOGIN_LOCK_MS;
    this.entries.set(key, entry);
  }

  recordSuccess(email: string) {
    this.entries.delete(this.key(email));
  }

  // Limita a memória: descarta o que já expirou quando o mapa cresce demais
  private prune(now: number) {
    if (this.entries.size < MAX_TRACKED) return;
    for (const [key, entry] of this.entries) {
      if (now - entry.firstAt > LOGIN_FAILURE_WINDOW_MS && entry.lockedUntil <= now) this.entries.delete(key);
    }
  }
}
