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

describe('JwtAuthGuard', () => {
  let jwtService: { verify: jest.Mock };
  let guard: JwtAuthGuard;

  beforeEach(() => {
    jwtService = { verify: jest.fn(() => payload) };
    guard = new JwtAuthGuard(jwtService as any);
  });

  it.each([
    ['sem header', {}],
    ['sem prefixo Bearer', { authorization: 'Token abc' }],
  ])('rejeita requisição %s', (_label, headers) => {
    expect(() => guard.canActivate(contextFor({ headers }))).toThrow(new UnauthorizedException('Token não fornecido.'));
  });

  it('rejeita token inválido ou expirado', () => {
    jwtService.verify.mockImplementation(() => {
      throw new Error('jwt expired');
    });

    expect(() => guard.canActivate(contextFor({ headers: { authorization: 'Bearer abc' } }))).toThrow('Token inválido ou expirado.');
  });

  it('preenche req.user com os dados do token', () => {
    const request: any = { headers: { authorization: 'Bearer abc' } };

    expect(guard.canActivate(contextFor(request))).toBe(true);
    expect(jwtService.verify).toHaveBeenCalledWith('abc');
    expect(request.user).toEqual({ id: 'u1', email: 'ana@teste.com', profileId: 'p1', profileName: 'ADMIN', organizationId: 'org-1' });
  });
});

describe('OptionalJwtAuthGuard', () => {
  let jwtService: { verify: jest.Mock };
  let guard: OptionalJwtAuthGuard;

  beforeEach(() => {
    jwtService = { verify: jest.fn(() => payload) };
    guard = new OptionalJwtAuthGuard(jwtService as any);
  });

  it('libera requisição sem token e sem usuário', () => {
    const request: any = { headers: {} };

    expect(guard.canActivate(contextFor(request))).toBe(true);
    expect(request.user).toBeUndefined();
    expect(jwtService.verify).not.toHaveBeenCalled();
  });

  it('valida o token quando enviado', () => {
    const request: any = { headers: { authorization: 'Bearer abc' } };

    expect(guard.canActivate(contextFor(request))).toBe(true);
    expect(request.user.id).toBe('u1');
  });

  it('rejeita token enviado mas inválido', () => {
    jwtService.verify.mockImplementation(() => {
      throw new Error('invalid');
    });

    expect(() => guard.canActivate(contextFor({ headers: { authorization: 'Bearer abc' } }))).toThrow(UnauthorizedException);
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
