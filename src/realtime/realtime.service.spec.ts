import { RealtimeService } from './realtime.service';

const alice = { id: 'u-alice', organizationId: 'org-1' };

const makeSocket = (user: { id: string; organizationId: string }) => ({
  data: { user },
  emit: jest.fn(),
  leave: jest.fn(),
});
const makeServer = (sockets: ReturnType<typeof makeSocket>[]) => ({ in: jest.fn(() => ({ fetchSockets: jest.fn(async () => sockets) })) });

describe('RealtimeService', () => {
  let service: RealtimeService;

  beforeEach(() => {
    service = new RealtimeService();
  });

  describe('disconnectUser', () => {
    it('desconecta todos os sockets da room do usuário', async () => {
      const disconnectSockets = jest.fn();
      const server = { in: jest.fn(() => ({ disconnectSockets })) };
      service.attach(server as any);

      await service.disconnectUser('u-alice');

      expect(server.in).toHaveBeenCalledWith('user:u-alice');
      expect(disconnectSockets).toHaveBeenCalledWith(true);
    });

    it('sem servidor ou com falha não lança', async () => {
      await expect(service.disconnectUser('u-alice')).resolves.toBeUndefined();
      service.attach({ in: () => { throw new Error('boom'); } } as any);
      await expect(service.disconnectUser('u-alice')).resolves.toBeUndefined();
    });
  });

  describe('canJoin', () => {
    it('org:<id> só da própria organização; user:<id> só do próprio usuário', async () => {
      expect(await service.canJoin(alice, 'org:org-1')).toBe(true);
      expect(await service.canJoin(alice, 'org:org-2')).toBe(false);
      expect(await service.canJoin(alice, 'user:u-alice')).toBe(true);
      expect(await service.canJoin(alice, 'user:u-bob')).toBe(false);
    });

    it('room desconhecida, sem id ou malformada é negada', async () => {
      for (const room of ['', 'org', 'org:', ':x', 'qualquer:1', 'marketing-board:org-1']) {
        expect(await service.canJoin(alice, room)).toBe(false);
      }
    });

    it('room de recurso usa a regra do módulo que a registrou, com o id do recurso', async () => {
      const authorizer = jest.fn(async (_user, id: string) => id === 'org-1');
      service.registerRoomType('marketing-board', authorizer);

      expect(await service.canJoin(alice, 'marketing-board:org-1')).toBe(true);
      expect(await service.canJoin(alice, 'marketing-board:org-2')).toBe(false);
      expect(authorizer).toHaveBeenCalledWith(alice, 'org-1');
    });

    it('erro na regra do módulo nega (fail closed)', async () => {
      service.registerRoomType('boom', async () => {
        throw new Error('banco fora');
      });

      expect(await service.canJoin(alice, 'boom:1')).toBe(false);
    });
  });

  describe('emit', () => {
    it('sem servidor (antes do gateway subir) não faz nada nem lança', async () => {
      await expect(service.emit('org:org-1', 'x', {})).resolves.toBeUndefined();
    });

    it('entrega só a quem ainda tem permissão; quem perdeu sai da room e recebe room:revoked', async () => {
      const allowed = makeSocket(alice);
      const revoked = makeSocket({ id: 'u-bob', organizationId: 'org-1' });
      service.registerRoomType('marketing-board', async (user) => user.id === 'u-alice');
      service.attach(makeServer([allowed, revoked]) as any);

      await service.emit('marketing-board:org-1', 'marketing.card.created', { cardId: 'c1' });

      expect(allowed.emit).toHaveBeenCalledWith('marketing.card.created', { cardId: 'c1' });
      expect(revoked.emit).not.toHaveBeenCalledWith('marketing.card.created', expect.anything());
      expect(revoked.leave).toHaveBeenCalledWith('marketing-board:org-1');
      expect(revoked.emit).toHaveBeenCalledWith('room:revoked', { room: 'marketing-board:org-1' });
    });

    it('consulta a permissão uma vez por usuário, mesmo com várias abas abertas', async () => {
      const authorizer = jest.fn(async () => true);
      service.registerRoomType('marketing-board', authorizer);
      service.attach(makeServer([makeSocket(alice), makeSocket(alice), makeSocket(alice)]) as any);

      await service.emit('marketing-board:org-1', 'e', {});

      expect(authorizer).toHaveBeenCalledTimes(1);
    });

    it('socket sem usuário (handshake incompleto) não recebe', async () => {
      const orphan = { data: {}, emit: jest.fn(), leave: jest.fn() };
      service.attach({ in: () => ({ fetchSockets: async () => [orphan] }) } as any);

      await service.emit('org:org-1', 'e', {});

      expect(orphan.emit).not.toHaveBeenCalled();
    });

    it('falha ao buscar os sockets não lança (tempo real não derruba a ação HTTP)', async () => {
      service.attach({ in: () => ({ fetchSockets: async () => Promise.reject(new Error('adapter')) }) } as any);

      await expect(service.emit('org:org-1', 'e', {})).resolves.toBeUndefined();
    });

    it('emitToUser usa a room user:<id>', async () => {
      const server = makeServer([makeSocket(alice)]);
      service.attach(server as any);

      await service.emitToUser('u-alice', 'notification.created', { n: 1 });

      expect(server.in).toHaveBeenCalledWith('user:u-alice');
    });
  });
});
