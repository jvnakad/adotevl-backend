import { AccessLevel, ADMIN_PERMISSIONS, Screen } from '../access/access';
import { RealtimeService } from '../realtime/realtime.service';
import { MarketingRealtimeService } from './marketing-realtime.service';

describe('MarketingRealtimeService', () => {
  const setup = (access: unknown, queryRows: any[] = []) => {
    const realtime = new RealtimeService();
    const accessService = { forUser: jest.fn(async () => access) };
    const dataSource = { query: jest.fn(async () => queryRows) };
    const service = new MarketingRealtimeService(dataSource as any, realtime, accessService as any);
    service.onModuleInit();
    return { service, realtime, dataSource, accessService };
  };
  const user = { id: 'u1', organizationId: 'org-1' };

  describe('permissão da room marketing-board:<orgId>', () => {
    it('Visualizar e Editar entram; a equipe Admin também', async () => {
      for (const permissions of [{ [Screen.MARKETING]: AccessLevel.VIEW }, { [Screen.MARKETING]: AccessLevel.EDIT }, ADMIN_PERMISSIONS]) {
        const { realtime } = setup({ isAdmin: false, permissions });
        expect(await realtime.canJoin(user, 'marketing-board:org-1')).toBe(true);
      }
    });

    it('sem a tela, sem equipe ou com permissão revogada é negado', async () => {
      expect(await setup({ permissions: { [Screen.PETS]: AccessLevel.EDIT } }).realtime.canJoin(user, 'marketing-board:org-1')).toBe(false);
      expect(await setup({ permissions: { [Screen.MARKETING]: AccessLevel.NONE } }).realtime.canJoin(user, 'marketing-board:org-1')).toBe(false);
      expect(await setup(null).realtime.canJoin(user, 'marketing-board:org-1')).toBe(false);
    });

    it('quadro de outra organização é negado sem nem consultar as permissões', async () => {
      const { realtime, accessService } = setup({ permissions: ADMIN_PERMISSIONS });

      expect(await realtime.canJoin(user, 'marketing-board:org-2')).toBe(false);
      expect(accessService.forUser).not.toHaveBeenCalled();
    });

    it('a permissão é lida a cada checagem: revogada depois do join, a próxima checagem nega', async () => {
      const { realtime, accessService } = setup({ permissions: { [Screen.MARKETING]: AccessLevel.VIEW } });
      expect(await realtime.canJoin(user, 'marketing-board:org-1')).toBe(true);

      accessService.forUser.mockResolvedValue({ permissions: {} } as any);

      expect(await realtime.canJoin(user, 'marketing-board:org-1')).toBe(false);
    });
  });

  describe('publicação', () => {
    it('payload leve: ids, campos, updatedAt do card e quem agiu; vai para a room do quadro da organização', async () => {
      const { service, realtime, dataSource } = setup({ permissions: ADMIN_PERMISSIONS });
      const emit = jest.spyOn(realtime, 'emit').mockResolvedValue();
      dataSource.query
        .mockResolvedValueOnce([{ listId: 'l1', position: 1024, updatedAt: '2026-10-20T12:00:00.000Z' }] as never)
        .mockResolvedValueOnce([{ name: 'Ana' }] as never);

      await service.publishCard('org-1', 'u-ana', 'marketing.card.updated', 'c1', { fields: ['title'] });

      expect(emit).toHaveBeenCalledWith(
        'marketing-board:org-1',
        'marketing.card.updated',
        expect.objectContaining({ cardId: 'c1', listId: 'l1', position: 1024, updatedAt: '2026-10-20T12:00:00.000Z', fields: ['title'], actor: { id: 'u-ana', name: 'Ana' } }),
      );
      const payload = emit.mock.calls[0][2] as Record<string, unknown>;
      expect(Object.keys(payload)).not.toEqual(expect.arrayContaining(['title', 'description']));
    });

    it('falha ao publicar não lança', async () => {
      const { service, dataSource } = setup({ permissions: ADMIN_PERMISSIONS });
      dataSource.query.mockRejectedValue(new Error('banco') as never);

      await expect(service.publishCard('org-1', 'u', 'e', 'c1')).resolves.toBeUndefined();
      await expect(service.publish('org-1', 'u', 'e', {})).resolves.toBeUndefined();
    });
  });
});
