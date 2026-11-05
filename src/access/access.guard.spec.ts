import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessGuard } from './access.guard';
import { AdminOnly, RequireAccess } from './access.decorator';
import { AccessLevel, Screen, UserAccess } from './access';

// Handler "decorado" de verdade: o guard lê os metadados pelo Reflector, como no Nest
const handlerWith = (...decorators: MethodDecorator[]) => {
  class Controller {
    handler() {}
  }
  const descriptor = Object.getOwnPropertyDescriptor(Controller.prototype, 'handler');
  decorators.forEach((decorate) => decorate(Controller.prototype, 'handler', descriptor));
  return { handler: Controller.prototype.handler, controller: Controller };
};

const contextFor = (request: Record<string, any>, target = handlerWith()) =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => target.handler,
    getClass: () => target.controller,
  }) as unknown as ExecutionContext;

const access = (overrides: Partial<UserAccess> = {}): UserAccess => ({
  teamId: 't1',
  teamName: 'Resgate',
  isAdmin: false,
  permissions: { [Screen.PETS]: AccessLevel.VIEW },
  ...overrides,
});

describe('AccessGuard', () => {
  let accessService: { forUser: jest.Mock };
  let guard: AccessGuard;
  const request = () => ({ user: { id: 'u1' } }) as Record<string, any>;

  beforeEach(() => {
    accessService = { forUser: jest.fn(async () => access()) };
    guard = new AccessGuard(new Reflector(), accessService as any);
  });

  it('libera rota sem exigência de acesso, sem consultar a equipe', async () => {
    await expect(guard.canActivate(contextFor(request()))).resolves.toBe(true);
    expect(accessService.forUser).not.toHaveBeenCalled();
  });

  it('libera quem tem o nível exigido e guarda o acesso na requisição', async () => {
    const req = request();

    await expect(guard.canActivate(contextFor(req, handlerWith(RequireAccess(Screen.PETS, AccessLevel.VIEW))))).resolves.toBe(true);
    expect(accessService.forUser).toHaveBeenCalledWith('u1');
    expect(req.access).toEqual(access());
  });

  it('Editar exige Editar: quem só visualiza recebe 403', async () => {
    const ctx = contextFor(request(), handlerWith(RequireAccess(Screen.PETS, AccessLevel.EDIT)));

    await expect(guard.canActivate(ctx)).rejects.toThrow(new ForbiddenException('Sua equipe só pode visualizar Pets.'));
  });

  it('tela sem permissão recebe 403', async () => {
    const ctx = contextFor(request(), handlerWith(RequireAccess(Screen.FINANCIAL, AccessLevel.VIEW)));

    await expect(guard.canActivate(ctx)).rejects.toThrow(new ForbiddenException('Sua equipe não tem acesso a Financeiro.'));
  });

  it('usuário sem equipe recebe 403', async () => {
    accessService.forUser.mockResolvedValue(null);
    const ctx = contextFor(request(), handlerWith(RequireAccess(Screen.PETS, AccessLevel.VIEW)));

    await expect(guard.canActivate(ctx)).rejects.toThrow(new ForbiddenException('Seu usuário não está em nenhuma equipe. Fale com um administrador.'));
  });

  it('equipe Admin passa em qualquer tela', async () => {
    accessService.forUser.mockResolvedValue(access({ isAdmin: true, permissions: {} }));
    const ctx = contextFor(request(), handlerWith(RequireAccess(Screen.FINANCIAL, AccessLevel.EDIT)));

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  describe('@AdminOnly', () => {
    it('recusa quem não é da equipe Admin, mesmo com Editar na tela', async () => {
      accessService.forUser.mockResolvedValue(access({ permissions: { [Screen.PETS]: AccessLevel.EDIT } }));
      const ctx = contextFor(request(), handlerWith(RequireAccess(Screen.PETS, AccessLevel.EDIT), AdminOnly()));

      await expect(guard.canActivate(ctx)).rejects.toThrow(new ForbiddenException('Ação permitida só para a equipe Admin.'));
    });

    it('libera a equipe Admin', async () => {
      accessService.forUser.mockResolvedValue(access({ isAdmin: true }));
      const ctx = contextFor(request(), handlerWith(AdminOnly()));

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });
});
