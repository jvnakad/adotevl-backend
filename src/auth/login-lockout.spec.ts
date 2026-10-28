import { LoginLockout, LOGIN_LOCK_MS, LOGIN_MAX_FAILURES } from './login-lockout';

describe('LoginLockout', () => {
  const t0 = 1_000_000;

  it('bloqueia a conta após 8 falhas, mesmo variando maiúsculas no e-mail', () => {
    const lock = new LoginLockout();
    for (let i = 0; i < LOGIN_MAX_FAILURES - 1; i++) lock.recordFailure(i % 2 ? 'ANA@x.com' : 'ana@x.com', t0);
    expect(lock.retryAfterSeconds('ana@x.com', t0)).toBe(0);

    lock.recordFailure('ana@x.com', t0);
    expect(lock.retryAfterSeconds('ana@x.com', t0)).toBe(LOGIN_LOCK_MS / 1000);
  });

  it('libera depois do cooldown e recomeça a contagem', () => {
    const lock = new LoginLockout();
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) lock.recordFailure('a@x.com', t0);

    expect(lock.retryAfterSeconds('a@x.com', t0 + LOGIN_LOCK_MS + 1)).toBe(0);
    lock.recordFailure('a@x.com', t0 + LOGIN_LOCK_MS + 1);
    expect(lock.retryAfterSeconds('a@x.com', t0 + LOGIN_LOCK_MS + 1)).toBe(0);
  });

  it('sucesso zera as falhas e outra conta não é afetada', () => {
    const lock = new LoginLockout();
    for (let i = 0; i < LOGIN_MAX_FAILURES - 1; i++) lock.recordFailure('a@x.com', t0);
    lock.recordSuccess('a@x.com');
    lock.recordFailure('a@x.com', t0);
    expect(lock.retryAfterSeconds('a@x.com', t0)).toBe(0);
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) lock.recordFailure('b@x.com', t0);
    expect(lock.retryAfterSeconds('a@x.com', t0)).toBe(0);
  });
});
