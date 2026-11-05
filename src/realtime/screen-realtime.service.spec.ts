import { AccessLevel, ADMIN_PERMISSIONS, Screen } from '../access/access';
import { requestContext } from '../common/request-context';
import { RealtimeService } from './realtime.service';
import { SCREEN_CHANGED_EVENT, ScreenRealtimeService, screenRoom } from './screen-realtime.service';

describe('ScreenRealtimeService', () => {
  const setup = (access: unknown) => {
    const realtime = new RealtimeService();
    const accessService = { forUser: jest.fn(async () => access) };
    const service = new ScreenRealtimeService(realtime, accessService as any);
    service.onModuleInit();
    return { service, realtime, accessService };
  };
  const user = { id: 'u1', organizationId: 'org-1' };

  describe('permissão da room screen:<TELA>:<orgId>', () => {
    it('Visualizar ou Editar na tela entram; a equipe Admin também', async () => {
      for (const permissions of [{ [Screen.PETS]: AccessLevel.VIEW }, { [Screen.PETS]: AccessLevel.EDIT }, ADMIN_PERMISSIONS]) {
        const { realtime } = setup({ permissions });
        expect(await realtime.canJoin(user, 'screen:PETS:org-1')).toBe(true);
      }
    });

    it('sem acesso à tela, só com outra tela ou sem equipe é negado', async () => {
      expect(await setup({ permissions: { [Screen.ADOPTERS]: AccessLevel.EDIT } }).realtime.canJoin(user, 'screen:PETS:org-1')).toBe(false);
      expect(await setup({ permissions: { [Screen.PETS]: AccessLevel.NONE } }).realtime.canJoin(user, 'screen:PETS:org-1')).toBe(false);
      expect(await setup(null).realtime.canJoin(user, 'screen:PETS:org-1')).toBe(false);
    });

    it('outra organização, tela fora da lista (Financeiro) ou id malformado são negados sem consultar as permissões', async () => {
      const { realtime, accessService } = setup({ permissions: ADMIN_PERMISSIONS });

      expect(await realtime.canJoin(user, 'screen:PETS:org-2')).toBe(false);
      expect(await realtime.canJoin(user, 'screen:FINANCIAL:org-1')).toBe(false);
      expect(await realtime.canJoin(user, 'screen:INVENTADA:org-1')).toBe(false);
      expect(await realtime.canJoin(user, 'screen:org-1')).toBe(false);
      expect(accessService.forUser).not.toHaveBeenCalled();
    });
  });

  describe('publish', () => {
    it('emite screen.changed em cada tela afetada, só com ids, tipo e autor', async () => {
      const { service, realtime } = setup(null);
      const emit = jest.spyOn(realtime, 'emit').mockResolvedValue();

      await requestContext.run({ clientId: 'aba-1' }, () =>
        service.publish({ screens: [Screen.PETS, Screen.ADOPTERS, Screen.PETS], organizationId: 'org-1', resource: 'pet', kind: 'updated', id: 'p1', actorId: 'u1' }),
      );

      expect(emit).toHaveBeenCalledTimes(2);
      expect(emit).toHaveBeenCalledWith(screenRoom(Screen.PETS, 'org-1'), SCREEN_CHANGED_EVENT, {
        organizationId: 'org-1',
        screen: Screen.PETS,
        resource: 'pet',
        kind: 'updated',
        id: 'p1',
        actor: { id: 'u1' },
        clientId: 'aba-1',
        at: expect.any(String),
      });
      expect(emit).toHaveBeenCalledWith('screen:ADOPTERS:org-1', SCREEN_CHANGED_EVENT, expect.objectContaining({ screen: Screen.ADOPTERS }));
    });

    it('sem autor (formulário público, webhook) não manda actor nem clientId', async () => {
      const { service, realtime } = setup(null);
      const emit = jest.spyOn(realtime, 'emit').mockResolvedValue();

      await requestContext.run({ clientId: 'aba-1' }, () => service.publish({ screens: Screen.ADOPTERS, organizationId: 'org-1', resource: 'adoption-form', kind: 'created', id: 'f1' }));

      const payload = emit.mock.calls[0][2] as Record<string, unknown>;
      expect(payload).not.toHaveProperty('actor');
      expect(payload).not.toHaveProperty('clientId');
    });

    it('sem organização não emite, e falha do tempo real nunca derruba a ação', async () => {
      const { service, realtime } = setup(null);
      const emit = jest.spyOn(realtime, 'emit').mockRejectedValue(new Error('socket fora'));

      await service.publish({ screens: Screen.PETS, organizationId: null, resource: 'pet', kind: 'created' });
      expect(emit).not.toHaveBeenCalled();

      await expect(service.publish({ screens: Screen.PETS, organizationId: 'org-1', resource: 'pet', kind: 'created' })).resolves.toBeUndefined();
    });
  });
});
