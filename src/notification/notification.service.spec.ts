import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createMockRepository, MockRepository } from '../testing/mock-repository';
import { decodeCursor, encodeCursor, NotificationService } from './notification.service';
import { requestContext } from '../common/request-context';

const UUID = '3f2b8c1e-1a2b-4c3d-8e4f-5a6b7c8d9e0f';
const TS = '2026-10-20 12:00:00.123456+00';

describe('NotificationService', () => {
  let repo: MockRepository & { query: jest.Mock };
  let realtime: { emitToUser: jest.Mock };
  let service: NotificationService;

  beforeEach(() => {
    repo = { ...createMockRepository(), query: jest.fn() };
    repo.save.mockImplementation(async (data) => ({ id: 'n1', createdAt: new Date('2026-10-20T12:00:00Z'), readAt: null, ...data }));
    repo.count.mockResolvedValue(3);
    realtime = { emitToUser: jest.fn(async () => undefined) };
    service = new NotificationService(repo as any, realtime as any);
  });

  const input = { userId: 'u1', organizationId: 'org-1', type: 'MARKETING_MENTION', title: 'Fulano mencionou você' };
  const row = (n: number) => ({ id: `3f2b8c1e-1a2b-4c3d-8e4f-5a6b7c8d9e0${n}`, type: 'T', title: `n${n}`, body: null, link: null, metadata: null, readAt: null, createdAt: new Date(), cursorTs: `2026-10-20 12:00:0${n}.000001+00` });

  it('notify salva e avisa o dono em tempo real (room user) com a notificação e a contagem de não lidas', async () => {
    const saved = await service.notify({ ...input, link: '/marketing?card=c1', metadata: { cardId: 'c1' } });

    expect(saved).toMatchObject({ userId: 'u1', organizationId: 'org-1', link: '/marketing?card=c1', body: null });
    expect(realtime.emitToUser).toHaveBeenCalledWith('u1', 'notification.created', {
      notification: expect.objectContaining({ id: 'n1', type: 'MARKETING_MENTION', isRead: false, metadata: { cardId: 'c1' } }),
      unreadCount: 3,
    });
  });

  it('título e link são limitados ao tamanho da coluna', async () => {
    const saved = await service.notify({ ...input, title: 'x'.repeat(300), link: '/' + 'y'.repeat(600) });

    expect(saved.title).toHaveLength(200);
    expect(saved.link).toHaveLength(500);
  });

  it('falha ao salvar não lança e devolve null', async () => {
    repo.save.mockRejectedValue(new Error('banco'));

    await expect(service.notify(input)).resolves.toBeNull();
    expect(realtime.emitToUser).not.toHaveBeenCalled();
  });

  describe('listagem por cursor', () => {
    it('primeira página: limit+1 consultado, nextCursor da última devolvida e unreadCount', async () => {
      repo.query.mockResolvedValue([row(3), row(2), row(1)]);

      const result = await service.findAll('u1', { limit: 2 });

      const [sql, params] = repo.query.mock.calls[0];
      expect(sql).toContain('ORDER BY created_at DESC, id DESC');
      expect(sql).not.toContain('(created_at, id) <');
      expect(params).toEqual(['u1', 3]);
      expect(result.items.map((item) => item.title)).toEqual(['n3', 'n2']);
      expect(result.unreadCount).toBe(3);
      expect(decodeCursor(result.nextCursor)).toEqual({ createdAt: '2026-10-20 12:00:02.000001+00', id: row(2).id });
    });

    it('última página: nextCursor null', async () => {
      repo.query.mockResolvedValue([row(1)]);

      expect((await service.findAll('u1', { limit: 2 })).nextCursor).toBeNull();
    });

    it('com cursor continua depois dele, com o timestamp exato; unread filtra por read_at nulo', async () => {
      repo.query.mockResolvedValue([]);

      await service.findAll('u1', { limit: 5, unread: true, cursor: encodeCursor(TS, UUID) });

      const [sql, params] = repo.query.mock.calls[0];
      expect(sql).toContain('read_at IS NULL');
      expect(sql).toContain('(created_at, id) < ($2::timestamptz, $3::uuid)');
      expect(params).toEqual(['u1', TS, UUID, 6]);
    });

    it('padrão de 20 por página', async () => {
      repo.query.mockResolvedValue([]);

      await service.findAll('u1', {});

      expect(repo.query.mock.calls[0][1]).toEqual(['u1', 21]);
    });

    it('cursor adulterado é 400 (nunca vai para o SQL)', async () => {
      for (const cursor of ['lixo', Buffer.from('[1,2]').toString('base64url'), encodeCursor("2026-10-20'; DROP TABLE x", UUID), encodeCursor(TS, 'nao-uuid')]) {
        await expect(service.findAll('u1', { cursor })).rejects.toThrow(BadRequestException);
      }
      expect(repo.query).not.toHaveBeenCalled();
    });
  });

  describe('marcar como lida', () => {
    it('devolve só unreadCount, marca com a data e emite notification.read com o clientId da requisição', async () => {
      repo.findOne.mockResolvedValue({ id: 'n1', userId: 'u1', readAt: null });
      repo.count.mockResolvedValue(2);

      const result = await requestContext.run({ clientId: 'aba-1' }, () => service.markRead('n1', 'u1'));

      expect(result).toEqual({ unreadCount: 2 });
      expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ readAt: expect.any(Date) }));
      expect(realtime.emitToUser).toHaveBeenCalledWith('u1', 'notification.read', { ids: ['n1'], all: false, unreadCount: 2, clientId: 'aba-1' });
    });

    it('já lida mantém a data (não grava de novo)', async () => {
      repo.findOne.mockResolvedValue({ id: 'n1', userId: 'u1', readAt: new Date('2026-10-01') });

      await service.markRead('n1', 'u1');

      expect(repo.save).not.toHaveBeenCalled();
    });

    it('notificação de outro usuário ou inexistente é 404 (busca sempre pelo dono)', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.markRead('n1', 'u-outro')).rejects.toThrow(NotFoundException);
      expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'n1', userId: 'u-outro' } });
      expect(realtime.emitToUser).not.toHaveBeenCalled();
    });

    it('markAllRead atualiza só as não lidas do próprio usuário, devolve unreadCount 0 e emite notification.read all', async () => {
      const result = await service.markAllRead('u1');

      expect(repo.update).toHaveBeenCalledWith({ userId: 'u1', readAt: expect.anything() }, { readAt: expect.any(Date) });
      expect(result).toEqual({ unreadCount: 0 });
      expect(realtime.emitToUser).toHaveBeenCalledWith('u1', 'notification.read', { ids: null, all: true, unreadCount: 0, clientId: null });
    });
  });
});
