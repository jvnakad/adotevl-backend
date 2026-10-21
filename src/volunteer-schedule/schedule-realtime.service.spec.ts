import { AccessLevel, ADMIN_PERMISSIONS, Screen } from '../access/access';
import { RealtimeService } from '../realtime/realtime.service';
import { requestContext } from '../common/request-context';
import { ScheduleRealtimeService } from './schedule-realtime.service';

describe('ScheduleRealtimeService', () => {
  const setup = (access: unknown) => {
    const realtime = new RealtimeService();
    const accessService = { forUser: jest.fn(async () => access) };
    const service = new ScheduleRealtimeService(realtime, accessService as any);
    service.onModuleInit();
    return { service, realtime, accessService };
  };
  const user = { id: 'u1', organizationId: 'org-1' };

  describe('permissão da room schedule:<orgId>', () => {
    it('Visualizar e Editar entram; a equipe Admin também', async () => {
      for (const permissions of [{ [Screen.SCHEDULE]: AccessLevel.VIEW }, { [Screen.SCHEDULE]: AccessLevel.EDIT }, ADMIN_PERMISSIONS]) {
        const { realtime } = setup({ isAdmin: false, permissions });
        expect(await realtime.canJoin(user, 'schedule:org-1')).toBe(true);
      }
    });

    it('sem a tela, sem equipe ou só com outra tela é negado', async () => {
      expect(await setup({ permissions: { [Screen.PETS]: AccessLevel.EDIT } }).realtime.canJoin(user, 'schedule:org-1')).toBe(false);
      expect(await setup({ permissions: { [Screen.SCHEDULE]: AccessLevel.NONE } }).realtime.canJoin(user, 'schedule:org-1')).toBe(false);
      expect(await setup(null).realtime.canJoin(user, 'schedule:org-1')).toBe(false);
    });

    it('agenda de outra organização é negada sem consultar as permissões', async () => {
      const { realtime, accessService } = setup({ permissions: ADMIN_PERMISSIONS });

      expect(await realtime.canJoin(user, 'schedule:org-2')).toBe(false);
      expect(accessService.forUser).not.toHaveBeenCalled();
    });

    it('a permissão é lida a cada checagem: revogada depois do join, a próxima nega', async () => {
      const { realtime, accessService } = setup({ permissions: { [Screen.SCHEDULE]: AccessLevel.VIEW } });
      expect(await realtime.canJoin(user, 'schedule:org-1')).toBe(true);

      accessService.forUser.mockResolvedValue({ permissions: {} } as any);

      expect(await realtime.canJoin(user, 'schedule:org-1')).toBe(false);
    });
  });

  describe('publicação', () => {
    it('painel: payload só com organização, dias (únicos e ordenados), tipo, autor e clientId', async () => {
      const { service, realtime } = setup({ permissions: ADMIN_PERMISSIONS });
      const emit = jest.spyOn(realtime, 'emit').mockResolvedValue();

      await requestContext.run({ clientId: 'aba-1' }, () => service.publish('org-1', 'shift.created', ['2026-10-21', '2026-10-20', '2026-10-21'], 'u-ana'));

      expect(emit).toHaveBeenCalledWith('schedule:org-1', 'schedule.changed', {
        organizationId: 'org-1',
        dates: ['2026-10-20', '2026-10-21'],
        kind: 'shift.created',
        actor: { id: 'u-ana' },
        clientId: 'aba-1',
      });
    });

    it('LP: sem autor e sem clientId, mesmo que a requisição traga X-Client-Id', async () => {
      const { service, realtime } = setup({ permissions: ADMIN_PERMISSIONS });
      const emit = jest.spyOn(realtime, 'emit').mockResolvedValue();

      await requestContext.run({ clientId: 'aba-1' }, () => service.publish('org-1', 'shift.cancelled', ['2026-10-20']));

      expect(emit.mock.calls[0][2]).toEqual({ organizationId: 'org-1', dates: ['2026-10-20'], kind: 'shift.cancelled' });
    });

    it('falha ao publicar não lança', async () => {
      const { service, realtime } = setup({ permissions: ADMIN_PERMISSIONS });
      jest.spyOn(realtime, 'emit').mockRejectedValue(new Error('socket'));

      await expect(service.publish('org-1', 'lock.removed', ['2026-10-20'], 'u')).resolves.toBeUndefined();
    });
  });
});
