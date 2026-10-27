import { Logger, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { hashRefresh, newRefreshValue, REFRESH_CLEANUP_SQL, SESSION_EXPIRED_MESSAGE } from './refresh-token.service';
import { REFRESH_PURGE_FAMILY_AGE_DAYS, REFRESH_RETENTION_DAYS, REFRESH_TOKEN_TTL_DAYS } from './refresh-token.entity';
import { build, DAY, FAMILY, NOW, rowFor, Script, state, subject, USER_AGENT, USER_ID } from '../testing/refresh-token-fakes';

let logs: string[];
beforeEach(() => {
  // Só o Date é falso; timers e microtasks seguem reais
  jest.useFakeTimers({ now: NOW, doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'performance', 'hrtime'] });
  logs = [];
  for (const level of ['log', 'warn', 'error'] as const) jest.spyOn(Logger.prototype, level).mockImplementation((message: any) => void logs.push(String(message)));
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const events = () => logs.filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));

describe('hashRefresh e newRefreshValue', () => {
  it('o valor tem 43 caracteres base64url e o hash tem 64 hex, diferente do SHA-256 puro', () => {
    const raw = newRefreshValue();

    expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashRefresh(raw)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRefresh(raw)).not.toBe(createHash('sha256').update(raw).digest('hex'));
    expect(hashRefresh(raw)).toBe(hashRefresh(raw));
    expect(newRefreshValue()).not.toBe(raw);
  });
});

describe('RefreshTokenService.issue', () => {
  it('grava o HMAC (nunca o valor nem o SHA-256 puro), em família nova com o relógio do app, e devolve o par com fid', async () => {
    const { service, calls, jwt } = build();

    const pair = await service.issue(subject, USER_AGENT);

    const insert = calls.find((c) => c.sql.includes('INSERT INTO refresh_tokens'))!;
    const [userId, familyId, startedAt, tokenHash, ttl, userAgent] = insert.params;
    expect(userId).toBe(USER_ID);
    expect(familyId).toMatch(/^[0-9a-f-]{36}$/);
    expect(startedAt).toEqual(new Date(NOW));
    expect(tokenHash).toBe(hashRefresh(pair.refresh_token));
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).not.toBe(pair.refresh_token);
    expect(tokenHash).not.toBe(createHash('sha256').update(pair.refresh_token).digest('hex'));
    expect(ttl).toBe(REFRESH_TOKEN_TTL_DAYS);
    expect(userAgent).toBe(USER_AGENT);
    expect(jwt.sign).toHaveBeenCalledWith({ sub: USER_ID, email: 'ana@teste.com', profileId: 'p1', profileName: 'VOLUNTEER', organizationId: 'org-1', fid: familyId });
    expect(pair.refresh_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('trava a linha do usuário antes de inserir e revoga as famílias além de 10 na mesma transação', async () => {
    const { service, manager } = build();

    await service.issue(subject);

    const sqls = manager.query.mock.calls.map(([sql]) => sql as string);
    expect(sqls[0]).toContain('FOR NO KEY UPDATE');
    expect(sqls[1]).toContain('INSERT INTO refresh_tokens');
    expect(sqls[2]).toContain('OFFSET');
    expect(manager.query.mock.calls[2][1]).toEqual([USER_ID, 10]);
  });

  it('a 11ª família revoga a mais antiga: derruba o socket dela e loga a expulsão em warn', async () => {
    const OLD = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
    const { service, realtime } = build({ evicted: [OLD, OLD, OLD] });

    await service.issue(subject);

    expect(realtime.disconnectFamily).toHaveBeenCalledTimes(1);
    expect(realtime.disconnectFamily).toHaveBeenCalledWith(OLD);
    expect(events().filter((e) => e.event === 'auth.refresh_family_evicted')).toEqual([{ event: 'auth.refresh_family_evicted', userId: USER_ID, familyId: OLD }]);
    expect((Logger.prototype.warn as jest.Mock).mock.calls.some(([m]) => String(m).includes('refresh_family_evicted'))).toBe(true);
  });

  it('sem expulsão não derruba socket nenhum', async () => {
    const { service, realtime } = build();

    await service.issue(subject);

    expect(realtime.disconnectFamily).not.toHaveBeenCalled();
  });

  it('limpa depois do commit, para o usuário, com retenção de 7 dias, corte de 44 dias e sem poupar família', async () => {
    const { service, calls, committed } = build();

    await service.issue(subject);

    const cleanup = calls.find((c) => c.sql === REFRESH_CLEANUP_SQL)!;
    expect(committed).toEqual(['commit']);
    expect(calls.indexOf(cleanup)).toBeGreaterThan(calls.findIndex((c) => c.sql.includes('OFFSET')));
    expect(cleanup.params).toEqual([USER_ID, REFRESH_RETENTION_DAYS, new Date(NOW - REFRESH_PURGE_FAMILY_AGE_DAYS * DAY), null]);
  });

  it('falha na limpeza só loga: o par sai do mesmo jeito', async () => {
    const { service } = build({ failCleanup: true });

    const pair = await service.issue(subject);

    expect(pair.access_token).toBeTruthy();
    expect(logs.some((l) => l.includes('Falha na limpeza'))).toBe(true);
  });

  it('User-Agent maior que 255 é truncado', async () => {
    const { service, calls } = build();

    await service.issue(subject, 'a'.repeat(400));

    expect(calls.find((c) => c.sql.includes('INSERT INTO refresh_tokens'))!.params[5]).toHaveLength(255);
  });

  it('nenhum log tem refresh, hash, access ou User-Agent', async () => {
    const { service } = build({ evicted: ['9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'] });

    const pair = await service.issue(subject, USER_AGENT);

    const all = logs.join('\n');
    for (const needle of [pair.refresh_token, hashRefresh(pair.refresh_token), pair.access_token, 'AgenteSecreto']) expect(all).not.toContain(needle);
    expect(events().find((e) => e.event === 'auth.refresh_issued')).toEqual(expect.objectContaining({ userId: USER_ID }));
  });

  it('falha no banco não devolve par (e não emite)', async () => {
    const { service } = build({ failInsert: true });

    await expect(service.issue(subject)).rejects.toThrow('insert falhou');
  });
});

describe('RefreshTokenService.rotate', () => {
  const RAW = 'A'.repeat(43);
  const ctx = { userAgent: USER_AGENT, ip: '203.0.113.7' };
  const expectGeneric401 = async (promise: Promise<unknown>) => {
    const error = await promise.then(() => null, (e) => e);
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(error.getResponse()).toEqual({ statusCode: 401, message: SESSION_EXPIRED_MESSAGE, error: 'Unauthorized' });
  };

  it('consome antes de inserir; o par novo herda family_id e family_started_at da linha consumida', async () => {
    const started = new Date(NOW - 3 * DAY);
    const { service, calls, jwt } = build({ consume: [rowFor({ familyStartedAt: started })], subject: [state] });

    const pair = await service.rotate(RAW, ctx);

    const sqls = calls.map((c) => c.sql);
    expect(sqls.findIndex((s) => s.includes('SET used_at = now()'))).toBeLessThan(sqls.findIndex((s) => s.includes('INSERT INTO refresh_tokens')));
    expect(calls[0].params).toEqual([hashRefresh(RAW)]);
    const insert = calls.find((c) => c.sql.includes('INSERT INTO refresh_tokens'))!;
    expect(insert.params.slice(0, 3)).toEqual([USER_ID, FAMILY, started]);
    expect(insert.params[3]).toBe(hashRefresh(pair.refresh_token));
    expect(pair.refresh_token).not.toBe(RAW);
    expect(jwt.sign).toHaveBeenCalledWith({ sub: USER_ID, email: 'ana@teste.com', profileId: 'p1', profileName: 'VOLUNTEER', organizationId: 'org-1', fid: FAMILY });
  });

  it('os claims do access vêm do banco, nunca do que o cliente mandou', async () => {
    const { service, jwt } = build({ consume: [rowFor()], subject: [{ ...state, email: 'novo@teste.com', organizationId: 'org-9' }] });

    await service.rotate(RAW, ctx);

    expect(jwt.sign.mock.calls[0][0]).toEqual(expect.objectContaining({ email: 'novo@teste.com', organizationId: 'org-9' }));
  });

  it('limpa a família depois do commit poupando a que acabou de rotacionar e loga refresh_rotated', async () => {
    const { service, calls } = build({ consume: [rowFor()], subject: [state] });

    await service.rotate(RAW, ctx);

    const cleanup = calls.find((c) => c.sql === REFRESH_CLEANUP_SQL)!;
    expect(cleanup.params[0]).toBe(USER_ID);
    expect(cleanup.params[3]).toBe(FAMILY);
    expect(events()).toContainEqual({ event: 'auth.refresh_rotated', userId: USER_ID, familyId: FAMILY });
  });

  it('sem equipe ativa recebe o par (CA-14)', async () => {
    const { service } = build({ consume: [rowFor()], subject: [{ ...state, systemKey: null }] });

    await expect(service.rotate(RAW, ctx)).resolves.toEqual({ access_token: expect.any(String), refresh_token: expect.any(String) });
  });

  describe('0 linhas consumidas', () => {
    it('reuso de token consumido revoga a família, derruba o socket e loga refresh_reuse com o IP', async () => {
      const { service, calls, realtime } = build({ classify: [{ userId: USER_ID, familyId: FAMILY, usedAt: new Date(NOW - 1000), revokedAt: null }] });

      await expectGeneric401(service.rotate(RAW, ctx));

      expect(calls.some((c) => c.sql.includes('SET revoked_at = now() WHERE family_id') && c.params[0] === FAMILY)).toBe(true);
      expect(realtime.disconnectFamily).toHaveBeenCalledWith(FAMILY);
      expect(events()).toContainEqual({ event: 'auth.refresh_reuse', userId: USER_ID, familyId: FAMILY, ip: '203.0.113.7' });
    });

    it('a classificação não filtra por validade: consumido e vencido também é reuso (CA-56)', async () => {
      const { service, calls } = build({ classify: [{ userId: USER_ID, familyId: FAMILY, usedAt: new Date(NOW - 20 * DAY), revokedAt: null }] });

      await expectGeneric401(service.rotate(RAW, ctx));

      expect(calls.find((c) => c.sql.includes('FROM refresh_tokens WHERE token_hash'))!.sql).not.toContain('expires_at');
      expect(events().map((e) => e.event)).toContain('auth.refresh_reuse');
    });

    it('revogado (logout, recusa, limite) loga refresh_rejected com motivo revogado', async () => {
      const { service } = build({ classify: [{ userId: USER_ID, familyId: FAMILY, usedAt: null, revokedAt: new Date(NOW - 1000) }], revokeAffected: 0 });

      await expectGeneric401(service.rotate(RAW, ctx));

      expect(events()).toContainEqual({ event: 'auth.refresh_rejected', userId: USER_ID, familyId: FAMILY, ip: '203.0.113.7', motivo: 'revogado' });
    });

    it('vencido que nunca foi consumido não revoga nada nem derruba socket', async () => {
      const { service, calls, realtime } = build({ classify: [{ userId: USER_ID, familyId: FAMILY, usedAt: null, revokedAt: null }] });

      await expectGeneric401(service.rotate(RAW, ctx));

      expect(calls.some((c) => c.sql.includes('SET revoked_at'))).toBe(false);
      expect(realtime.disconnectFamily).not.toHaveBeenCalled();
      expect(events()).toContainEqual(expect.objectContaining({ event: 'auth.refresh_rejected', motivo: 'expirado' }));
    });

    it('inexistente não revoga e não tem userId no log', async () => {
      const { service, calls } = build({ classify: [] });

      await expectGeneric401(service.rotate(RAW, ctx));

      expect(calls.some((c) => c.sql.includes('SET revoked_at'))).toBe(false);
      expect(events()).toContainEqual({ event: 'auth.refresh_rejected', ip: '203.0.113.7', motivo: 'inexistente' });
    });
  });

  describe('teto de 30 dias (relógio do app, CA-57)', () => {
    it('29 dias e 23 h ainda renova', async () => {
      const { service } = build({ consume: [rowFor({ familyStartedAt: new Date(NOW - 30 * DAY + 3_600_000) })], subject: [state] });

      await expect(service.rotate(RAW, ctx)).resolves.toBeDefined();
    });

    it('30 dias e 1 min recusa, revoga a família e loga o motivo teto', async () => {
      const { service, realtime } = build({ consume: [rowFor({ familyStartedAt: new Date(NOW - 30 * DAY - 60_000) })], subject: [state] });

      await expectGeneric401(service.rotate(RAW, ctx));

      expect(realtime.disconnectFamily).toHaveBeenCalledWith(FAMILY);
      expect(events()).toContainEqual(expect.objectContaining({ event: 'auth.refresh_rejected', motivo: 'teto' }));
    });
  });

  describe('recusas por estado revogam a família (CA-13, CA-58)', () => {
    it.each([
      ['inativo', { isActive: false }, 'inativo'],
      ['não confirmado', { isConfirmed: false }, 'nao_confirmado'],
      ['não aprovado', { isApproved: false }, 'nao_aprovado'],
      ['volante', { systemKey: 'FLOATING_VOLUNTEER' }, 'volante'],
      ['senha trocada depois do início da família', { passwordChangedAt: new Date(NOW - 60_000) }, 'senha_trocada'],
      ['usuário inexistente', null, 'inexistente'],
    ])('%s', async (_label, patch, motivo) => {
      const { service, realtime } = build({ consume: [rowFor({ familyStartedAt: new Date(NOW - DAY) })], subject: patch ? [{ ...state, ...patch }] : [] });

      await expectGeneric401(service.rotate(RAW, ctx));

      expect(realtime.disconnectFamily).toHaveBeenCalledWith(FAMILY);
      expect(events()).toContainEqual(expect.objectContaining({ event: 'auth.refresh_rejected', motivo }));
    });

    it('família que começou no mesmo ms da troca de senha é aceita (a família nova do perfil)', async () => {
      const started = new Date(NOW - 5000);
      const { service } = build({ consume: [rowFor({ familyStartedAt: started })], subject: [{ ...state, passwordChangedAt: started }] });

      await expect(service.rotate(RAW, ctx)).resolves.toBeDefined();
    });
  });

  it('a revogação é gravada antes do 401: a transação fecha com sucesso e só depois a exceção sai', async () => {
    const { service, committed } = build({ consume: [rowFor()], subject: [{ ...state, isActive: false }] });

    await expectGeneric401(service.rotate(RAW, ctx));

    expect(committed).toEqual(['commit']);
  });

  it('falha no insert não devolve token (a transação cai inteira)', async () => {
    const { service, committed } = build({ consume: [rowFor()], subject: [state], failInsert: true });

    await expect(service.rotate(RAW, ctx)).rejects.toThrow('insert falhou');
    expect(committed).toEqual([]);
  });

  it('a resposta 401 é idêntica para todos os motivos (CA-62)', async () => {
    const scenarios: Script[] = [
      { classify: [] },
      { classify: [{ userId: USER_ID, familyId: FAMILY, usedAt: null, revokedAt: null }] },
      { classify: [{ userId: USER_ID, familyId: FAMILY, usedAt: new Date(), revokedAt: null }] },
      { classify: [{ userId: USER_ID, familyId: FAMILY, usedAt: null, revokedAt: new Date() }] },
      { consume: [rowFor()], subject: [{ ...state, isActive: false }] },
      { consume: [rowFor({ familyStartedAt: new Date(NOW - 31 * DAY) })], subject: [state] },
      { consume: [rowFor()], subject: [{ ...state, systemKey: 'FLOATING_VOLUNTEER' }] },
    ];
    const bodies = new Set<string>();
    for (const script of scenarios) {
      const { service } = build(script);
      const error = await service.rotate(RAW, ctx).then(() => null, (e) => e);
      bodies.add(JSON.stringify({ status: error.getStatus(), body: error.getResponse() }));
    }

    expect(bodies.size).toBe(1);
    expect(JSON.parse([...bodies][0])).toEqual({ status: 401, body: { statusCode: 401, message: SESSION_EXPIRED_MESSAGE, error: 'Unauthorized' } });
  });

  it('nenhum log tem refresh, hash, access ou User-Agent', async () => {
    const ok = build({ consume: [rowFor()], subject: [state] });
    const pair = await ok.service.rotate(RAW, ctx);
    const bad = build({ classify: [{ userId: USER_ID, familyId: FAMILY, usedAt: new Date(), revokedAt: null }] });
    await bad.service.rotate(RAW, ctx).catch(() => undefined);

    const all = logs.join('\n');
    for (const needle of [RAW, pair.refresh_token, pair.access_token, hashRefresh(RAW), hashRefresh(pair.refresh_token), 'AgenteSecreto']) expect(all).not.toContain(needle);
  });

  it('falha na limpeza só loga', async () => {
    const { service } = build({ consume: [rowFor()], subject: [state], failCleanup: true });

    await expect(service.rotate(RAW, ctx)).resolves.toBeDefined();
  });
});

describe('RefreshTokenService.revokeFamily', () => {
  const RAW = 'B'.repeat(43);

  it('revoga a família do hash num comando só, sem filtrar por validade, loga auth.logout e derruba o socket', async () => {
    const { service, calls, realtime } = build();

    await service.revokeFamily(RAW);

    const revoke = calls.find((c) => c.sql.includes('SET revoked_at = now()'))!;
    expect(revoke.params).toEqual([hashRefresh(RAW)]);
    expect(revoke.sql).not.toContain('expires_at');
    expect(realtime.disconnectFamily).toHaveBeenCalledWith(FAMILY);
    expect(events()).toContainEqual({ event: 'auth.logout', userId: USER_ID, familyId: FAMILY });
  });

  it('token desconhecido, vencido, consumido ou já revogado (nada afetado): não lança, não loga, não derruba', async () => {
    const { service, dataSource, realtime } = build();
    dataSource.query.mockResolvedValue([]);

    await expect(service.revokeFamily(RAW)).resolves.toBeUndefined();

    expect(logs).toEqual([]);
    expect(realtime.disconnectFamily).not.toHaveBeenCalled();
  });

  it('o log do logout não tem o refresh nem o hash', async () => {
    const { service } = build();

    await service.revokeFamily(RAW);

    expect(logs.join('\n')).not.toContain(RAW);
    expect(logs.join('\n')).not.toContain(hashRefresh(RAW));
  });
});

describe('REFRESH_CLEANUP_SQL (SEC-BUG-02)', () => {
  it('filtra por usuário nas duas sondas e só apaga família inteira, nunca por expires_at sozinho', () => {
    expect(REFRESH_CLEANUP_SQL.match(/p\.user_id = \$1/g)).toHaveLength(1);
    expect(REFRESH_CLEANUP_SQL.match(/d\.user_id = \$1/g)).toHaveLength(1);
    expect(REFRESH_CLEANUP_SQL).toContain('NOT EXISTS');
    expect(REFRESH_CLEANUP_SQL).toContain('r.family_started_at < $3::timestamptz');
  });
});
