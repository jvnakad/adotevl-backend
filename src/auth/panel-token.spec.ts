import { JwtService } from '@nestjs/jwt';
import { accessTokenTtl, APPROVAL_LINK_TTL, panelJwtOptions, panelTokenPayload } from './panel-token';

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

describe('JwtModule do painel (SEC-06, §11.3)', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });
  const claimsOf = (jwt: JwtService, token: string) => jwt.decode(token) as { iat: number; exp: number; fid?: string; scope?: string };
  const subject = { id: 'u1', email: 'a@b.c', profileId: 'p1', organizationId: 'o1' };

  it('um sign sem expiresIn vale 900 s (nunca 8 h)', () => {
    delete process.env.ACCESS_TOKEN_TTL;
    const jwt = new JwtService(panelJwtOptions());

    const claims = claimsOf(jwt, jwt.sign(panelTokenPayload(subject, 'f1')));

    expect(claims.exp - claims.iat).toBe(900);
  });

  it('segue o ACCESS_TOKEN_TTL', () => {
    process.env.ACCESS_TOKEN_TTL = '1m';
    const jwt = new JwtService(panelJwtOptions());

    const claims = claimsOf(jwt, jwt.sign(panelTokenPayload(subject)));

    expect(claims.exp - claims.iat).toBe(60);
  });

  it('o token do e-mail de aprovação vale 8 h (28.800 s) com e sem ACCESS_TOKEN_TTL, sem fid nem scope', () => {
    for (const ttl of [undefined, '1m']) {
      if (ttl) process.env.ACCESS_TOKEN_TTL = ttl;
      else delete process.env.ACCESS_TOKEN_TTL;
      const jwt = new JwtService(panelJwtOptions());

      const claims = claimsOf(jwt, jwt.sign(panelTokenPayload(subject), { expiresIn: APPROVAL_LINK_TTL }));

      expect(claims.exp - claims.iat).toBe(28_800);
      expect(claims).not.toHaveProperty('fid');
      expect(claims).not.toHaveProperty('scope');
    }
  });
});
