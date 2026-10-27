import { accessTokenTtl, APPROVAL_LINK_TTL, panelTokenPayload } from './panel-token';

describe('accessTokenTtl', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('sem a variável vale 15 minutos (900 s)', () => {
    delete process.env.ACCESS_TOKEN_TTL;

    expect(accessTokenTtl()).toBe(900);
  });

  it.each([
    ['1m', 60],
    ['15m', 900],
    ['60m', 3600],
    ['90s', 90],
  ])('aceita %s', (value, seconds) => {
    process.env.ACCESS_TOKEN_TTL = value;

    expect(accessTokenTtl()).toBe(seconds);
  });

  it.each(['15 minutos', 'abc', '61m', '30d', '3601s', '0m', '-5m', '1.5m', '8h'])('derruba o boot com %p, sem repetir o valor', (value) => {
    process.env.ACCESS_TOKEN_TTL = value;

    expect(() => accessTokenTtl()).toThrow('ACCESS_TOKEN_TTL inválido.');
    try {
      accessTokenTtl();
    } catch (error) {
      expect((error as Error).message).not.toContain(value.trim() || 'x');
    }
  });

  it('o link de aprovação vale 8 h', () => {
    expect(APPROVAL_LINK_TTL).toBe('8h');
  });
});

describe('panelTokenPayload', () => {
  const subject = { id: 'u1', email: 'ana@teste.com', profileId: 'p1', profileName: 'VOLUNTEER', organizationId: 'org-1' };

  it('inclui o fid quando há família', () => {
    expect(panelTokenPayload(subject, 'f1')).toEqual({ sub: 'u1', email: 'ana@teste.com', profileId: 'p1', profileName: 'VOLUNTEER', organizationId: 'org-1', fid: 'f1' });
  });

  it('sem família não tem a chave fid', () => {
    expect(panelTokenPayload(subject)).not.toHaveProperty('fid');
  });

  it('nunca tem scope', () => {
    expect(panelTokenPayload(subject, 'f1')).not.toHaveProperty('scope');
  });
});
