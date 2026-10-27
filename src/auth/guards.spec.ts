import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';
import { RolesGuard } from './roles.guard';

const contextFor = (request: Record<string, any>) =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  }) as unknown as ExecutionContext;

const payload = { sub: 'u1', email: 'ana@teste.com', profileId: 'p1', profileName: 'ADMIN', organizationId: 'org-1', iat: 1 };

const INVALID = 'Token inválido ou expirado.';
const activeState = { isActive: true, passwordChangedAt: null, systemKey: null };

describe('JwtAuthGuard', () => {
  let jwtService: { verify: jest.Mock };
  let dataSource: { query: jest.Mock };
  let guard: JwtAuthGuard;
  const request = () => ({ headers: { authorization: 'Bearer abc' } }) as any;

  beforeEach(() => {
    jwtService = { verify: jest.fn(() => payload) };
    dataSource = { query: jest.fn(async () => [activeState]) };
    guard = new JwtAuthGuard(jwtService as any, dataSource as any);
  });

  it.each([
    ['sem header', {}],
    ['sem prefixo Bearer', { authorization: 'Token abc' }],
  ])('rejeita requisição %s', async (_label, headers) => {
    await expect(guard.canActivate(contextFor({ headers }))).rejects.toThrow(new UnauthorizedException('Token não fornecido.'));
  });

  it('rejeita token inválido ou expirado', async () => {
    jwtService.verify.mockImplementation(() => {
      throw new Error('jwt expired');
    });

    await expect(guard.canActivate(contextFor(request()))).rejects.toThrow(INVALID);
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('preenche req.user com os dados do token e confere só HS256', async () => {
    const req = request();

    expect(await guard.canActivate(contextFor(req))).toBe(true);
    expect(jwtService.verify).toHaveBeenCalledWith('abc', { algorithms: ['HS256'] });
    expect(req.user).toEqual({ id: 'u1', email: 'ana@teste.com', profileId: 'p1', profileName: 'ADMIN', organizationId: 'org-1' });
  });

  it('lê o estado do usuário pelo id do token, numa query enxuta (sem joins eager)', async () => {
    await guard.canActivate(contextFor(request()));

    const [sql, params] = dataSource.query.mock.calls[0];
    expect(params).toEqual(['u1', null]);
    expect(sql).toContain('FROM users u');
    expect(sql).toContain('password_changed_at');
  });

  it.each([
    ['token da agenda', { ...payload, scope: 'schedule' }],
    ['token de redefinição de senha', { ...payload, scope: 'password-reset', codeId: 'c1' }],
    ['token sem iat (CA-57)', { ...payload, iat: undefined }],
    ['token sem sub', { ...payload, sub: undefined }],
  ])('recusa %s sem nem consultar o banco', async (_label, claims) => {
    jwtService.verify.mockReturnValue(claims);

    await expect(guard.canActivate(contextFor(request()))).rejects.toThrow(INVALID);
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it.each([
    ['usuário inexistente', []],
    ['usuário inativo', [{ ...activeState, isActive: false }]],
    ['volante (CA-60)', [{ ...activeState, systemKey: 'FLOATING_VOLUNTEER' }]],
  ])('recusa %s (RN-32)', async (_label, rows) => {
    dataSource.query.mockResolvedValue(rows);

    await expect(guard.canActivate(contextFor(request()))).rejects.toThrow(INVALID);
  });

  it('usuário de outra equipe passa', async () => {
    dataSource.query.mockResolvedValue([{ ...activeState, systemKey: 'FIXED_VOLUNTEER' }]);

    expect(await guard.canActivate(contextFor(request()))).toBe(true);
  });

  describe('sessão revogada pela troca de senha (RN-21, RN-30)', () => {
    // iat do token = 1 s; compara em segundos inteiros
    const changedAt = (seconds: number, millis = 0) => new Date(seconds * 1000 + millis);

    it('iat menor que o segundo da troca é recusado', async () => {
      dataSource.query.mockResolvedValue([{ ...activeState, passwordChangedAt: changedAt(2) }]);

      await expect(guard.canActivate(contextFor(request()))).rejects.toThrow(INVALID);
    });

    it('iat no mesmo segundo da troca vale (o token novo do perfil, RN-30), mesmo com milissegundos', async () => {
      dataSource.query.mockResolvedValue([{ ...activeState, passwordChangedAt: changedAt(1, 900) }]);

      expect(await guard.canActivate(contextFor(request()))).toBe(true);
    });

    it('iat maior que a troca vale', async () => {
      jwtService.verify.mockReturnValue({ ...payload, iat: 10 });
      dataSource.query.mockResolvedValue([{ ...activeState, passwordChangedAt: changedAt(2) }]);

      expect(await guard.canActivate(contextFor(request()))).toBe(true);
    });
  });
  describe('família do refresh (fid, SEC-09)', () => {
    const FID = '3f2b8c1e-5a7d-4e9b-8c3a-1d2e3f4a5b6c';

    it('fid de família viva passa, com a mesma consulta (0 idas a mais ao banco)', async () => {
      jwtService.verify.mockReturnValue({ ...payload, fid: FID });
      dataSource.query.mockResolvedValue([{ ...activeState, familyAlive: true }]);

      expect(await guard.canActivate(contextFor(request()))).toBe(true);
      expect(dataSource.query).toHaveBeenCalledTimes(1);
      expect(dataSource.query.mock.calls[0][1]).toEqual(['u1', FID]);
    });

    it('fid de família revogada dá 401', async () => {
      jwtService.verify.mockReturnValue({ ...payload, fid: FID });
      dataSource.query.mockResolvedValue([{ ...activeState, familyAlive: false }]);

      await expect(guard.canActivate(contextFor(request()))).rejects.toThrow(INVALID);
    });

    it('fid que não é UUID dá 401 sem consultar o banco (sem 500)', async () => {
      jwtService.verify.mockReturnValue({ ...payload, fid: "x'; DROP TABLE users;--" });

      await expect(guard.canActivate(contextFor(request()))).rejects.toThrow(INVALID);
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('access sem fid (legado de 8 h, aprovação) segue a regra antiga', async () => {
      expect(await guard.canActivate(contextFor(request()))).toBe(true);
      expect(dataSource.query.mock.calls[0][1]).toEqual(['u1', null]);
    });
  });
});

describe('OptionalJwtAuthGuard', () => {
  let jwtService: { verify: jest.Mock };
  let dataSource: { query: jest.Mock };
  let guard: OptionalJwtAuthGuard;

  beforeEach(() => {
    jwtService = { verify: jest.fn(() => payload) };
    dataSource = { query: jest.fn(async () => [activeState]) };
    guard = new OptionalJwtAuthGuard(jwtService as any, dataSource as any);
  });

  it('libera requisição sem token e sem usuário', async () => {
    const request: any = { headers: {} };

    expect(await guard.canActivate(contextFor(request))).toBe(true);
    expect(request.user).toBeUndefined();
    expect(jwtService.verify).not.toHaveBeenCalled();
  });

  it('valida o token quando enviado', async () => {
    const request: any = { headers: { authorization: 'Bearer abc' } };

    expect(await guard.canActivate(contextFor(request))).toBe(true);
    expect(request.user.id).toBe('u1');
  });

  it('rejeita token enviado mas inválido', async () => {
    jwtService.verify.mockImplementation(() => {
      throw new Error('invalid');
    });

    await expect(guard.canActivate(contextFor({ headers: { authorization: 'Bearer abc' } }))).rejects.toThrow(UnauthorizedException);
  });

  it('rejeita token enviado de usuário volante', async () => {
    dataSource.query.mockResolvedValue([{ ...activeState, systemKey: 'FLOATING_VOLUNTEER' }]);

    await expect(guard.canActivate(contextFor({ headers: { authorization: 'Bearer abc' } }))).rejects.toThrow(UnauthorizedException);
  });
});

describe('RolesGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new RolesGuard(reflector as unknown as Reflector);
  });

  it('libera rota sem @Roles', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    expect(guard.canActivate(contextFor({}))).toBe(true);
  });

  it('libera perfil permitido', () => {
    reflector.getAllAndOverride.mockReturnValue(['ADMIN', 'VOLUNTEER']);

    expect(guard.canActivate(contextFor({ user: { profileName: 'VOLUNTEER' } }))).toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith('roles', [expect.any(Function), expect.any(Function)]);
  });

  it.each([
    ['perfil não permitido', { user: { profileName: 'FINANCIAL' } }],
    ['requisição sem usuário', {}],
  ])('bloqueia %s', (_label, request) => {
    reflector.getAllAndOverride.mockReturnValue(['ADMIN']);

    expect(() => guard.canActivate(contextFor(request))).toThrow(ForbiddenException);
  });
});
