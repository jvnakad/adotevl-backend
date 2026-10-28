import { isPanelSessionValid, isUuid, REFRESH_SUBJECT_SQL, SESSION_STATE_SQL, sessionRefusal } from './session-state';

const FID = '3f2b8c1e-5a7d-4e9b-8c3a-1d2e3f4a5b6c';
const active = { isActive: true, passwordChangedAt: null, systemKey: null };
const claims = { sub: 'u1', iat: 100 };

describe('sessionRefusal', () => {
  it('estado sem restrição não recusa', () => {
    expect(sessionRefusal(active, 100, 'second')).toBeNull();
    expect(sessionRefusal(active, 100, 'ms')).toBeNull();
  });

  it.each([
    ['inexistente', undefined, 'inexistente'],
    ['inativo', { ...active, isActive: false }, 'inativo'],
    ['não confirmado', { ...active, isConfirmed: false }, 'nao_confirmado'],
    ['não aprovado', { ...active, isApproved: false }, 'nao_aprovado'],
    ['volante', { ...active, systemKey: 'FLOATING_VOLUNTEER' }, 'volante'],
    ['família revogada', { ...active, familyAlive: false }, 'familia_revogada'],
  ])('recusa %s', (_label, state, reason) => {
    expect(sessionRefusal(state as any, 100, 'second')).toBe(reason);
  });

  it('confirmado e aprovado ausentes (access) não recusam', () => {
    expect(sessionRefusal({ ...active }, 100, 'second')).toBeNull();
    expect(sessionRefusal({ ...active, isConfirmed: true, isApproved: true }, 100, 'ms')).toBeNull();
  });

  describe('precisão em segundos (access)', () => {
    it('iat de um segundo antes da troca recusa; o mesmo segundo vale', () => {
      const state = { ...active, passwordChangedAt: new Date(100_900) };

      expect(sessionRefusal(state, 99, 'second')).toBe('senha_trocada');
      expect(sessionRefusal(state, 100, 'second')).toBeNull();
    });
  });

  describe('precisão em ms (família)', () => {
    it('1 ms antes de password_changed_at recusa; o mesmo ms aceita', () => {
      const state = { ...active, passwordChangedAt: new Date(100_900) };

      expect(sessionRefusal(state, 100_899, 'ms')).toBe('senha_trocada');
      expect(sessionRefusal(state, 100_900, 'ms')).toBeNull();
      expect(sessionRefusal(state, 100_901, 'ms')).toBeNull();
    });
  });
});

describe('isPanelSessionValid', () => {
  let dataSource: { query: jest.Mock };
  beforeEach(() => {
    dataSource = { query: jest.fn(async () => [active]) };
  });

  it('sem fid (legado, aprovação): uma consulta com fid nulo e a regra antiga', async () => {
    expect(await isPanelSessionValid(dataSource as any, claims)).toBe(true);
    expect(dataSource.query).toHaveBeenCalledTimes(1);
    expect(dataSource.query).toHaveBeenCalledWith(SESSION_STATE_SQL, ['u1', null]);
  });

  it('com fid vivo: uma consulta só, passando o fid', async () => {
    dataSource.query.mockResolvedValue([{ ...active, familyAlive: true }]);

    expect(await isPanelSessionValid(dataSource as any, { ...claims, fid: FID })).toBe(true);
    expect(dataSource.query).toHaveBeenCalledTimes(1);
    expect(dataSource.query).toHaveBeenCalledWith(SESSION_STATE_SQL, ['u1', FID]);
  });

  it('com fid de família revogada (ou de outro usuário, que o EXISTS não acha): recusa', async () => {
    dataSource.query.mockResolvedValue([{ ...active, familyAlive: false }]);

    expect(await isPanelSessionValid(dataSource as any, { ...claims, fid: FID })).toBe(false);
  });

  it.each([
    ['não é UUID', 'abc'],
    ['é número', 123],
    ['é objeto', { $ne: null }],
    ['é string vazia', ''],
    ['é null', null],
  ])('fid que %s recusa sem consultar o banco e sem erro', async (_label, fid) => {
    expect(await isPanelSessionValid(dataSource as any, { ...claims, fid })).toBe(false);
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it.each([
    ['com scope', { ...claims, scope: 'schedule' }],
    ['sem iat', { sub: 'u1' }],
    ['sem sub', { iat: 1 }],
    ['nulo', null],
  ])('payload %s recusa sem consultar o banco', async (_label, payload) => {
    expect(await isPanelSessionValid(dataSource as any, payload)).toBe(false);
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('erro de banco não vira aceite (fail-closed): a exceção sobe', async () => {
    dataSource.query.mockRejectedValue(new Error('db down'));

    await expect(isPanelSessionValid(dataSource as any, claims)).rejects.toThrow('db down');
  });
});

describe('SQL do estado de sessão', () => {
  it('o EXISTS da família amarra o usuário (r.user_id = u.id) e só olha linhas não revogadas', () => {
    expect(SESSION_STATE_SQL).toMatch(/r\.family_id = \$2::uuid AND r\.user_id = u\.id AND r\.revoked_at IS NULL/);
  });

  it('o refresh lê o estado e os claims numa consulta, com o mesmo fragmento de joins', () => {
    for (const column of ['is_confirmed', 'is_approved', 'email', 'profile_id', 'organization_id']) expect(REFRESH_SUBJECT_SQL).toContain(`u.${column}`);
    expect(REFRESH_SUBJECT_SQL).toContain('LEFT JOIN volunteers v ON v.user_id = u.id AND v.is_active = true');
  });
});

describe('isUuid', () => {
  it('aceita UUID e recusa o resto', () => {
    expect(isUuid(FID)).toBe(true);
    expect(isUuid(FID.toUpperCase())).toBe(true);
    expect(isUuid(`${FID}x`)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});
