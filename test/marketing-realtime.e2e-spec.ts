import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { io, Socket } from 'socket.io-client';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { TestAppModule, cleanupAccess, joinTeam } from './test-app.module';
import { Profile } from '../src/profile/profile.entity';
import { Organization } from '../src/organization/organization.entity';
import { User } from '../src/user/user.entity';
import { AccessLevel, Screen } from '../src/access/access';
import { TeamService } from '../src/team/team.service';

describe('Marketing: tempo real e notificações (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let orgRepo: Repository<Organization>;
  let userRepo: Repository<User>;
  let orgA: string;
  let orgB: string;
  let url: string;
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const teamIds: Record<string, string> = {};
  const sockets: Socket[] = [];

  const server = () => app.getHttpServer();
  const call = (method: 'get' | 'post' | 'patch' | 'delete', path: string, who: string, body?: object) => {
    const req = request(server())[method](path).set('Authorization', `Bearer ${tokens[who]}`);
    return body ? req.send(body) : req;
  };
  const login = async (email: string) => (await request(server()).post('/auth/login').send({ email, password: 'senha123' })).body.access_token;

  const CNPJ_A = '95959595959595';
  const CNPJ_B = '96969696969696';

  async function cleanOrg(cnpj: string) {
    const existing = await orgRepo.findOne({ where: { cnpj } });
    if (!existing) return;
    await cleanupAccess(app, existing.id);
    await userRepo.delete({ organizationId: existing.id });
    await orgRepo.delete({ id: existing.id });
  }

  async function createUser(organizationId: string, key: string, cpf: string, access: 'ADMIN' | Partial<Record<Screen, AccessLevel>>) {
    const profileRepo: Repository<Profile> = app.get(getRepositoryToken(Profile));
    const profile = await profileRepo.findOne({ where: { name: 'VOLUNTEER' } });
    const user = await userRepo.save({
      fullName: `Pessoa ${key}`,
      cpf,
      email: `${key}.realtime@teste.com`,
      password: await bcrypt.hash('senha123', 10),
      profileId: profile.id,
      organizationId,
      isConfirmed: true,
      isApproved: true,
      isActive: true,
    });
    const team = await joinTeam(app, user, access);
    teamIds[key] = team.id;
    ids[key] = user.id;
    tokens[key] = await login(`${key}.realtime@teste.com`);
  }

  /** Conecta e espera o resultado: `{ socket }` conectado ou `{ error }` do handshake. */
  const connect = (token?: string) =>
    new Promise<{ socket: Socket; error?: string }>((resolve) => {
      const socket = io(url, { auth: token === undefined ? {} : { token }, transports: ['websocket'], reconnection: false, forceNew: true });
      sockets.push(socket);
      socket.once('connect', () => resolve({ socket }));
      socket.once('connect_error', (error) => resolve({ socket, error: error.message }));
    });
  const connectAs = async (who: string) => {
    const { socket, error } = await connect(tokens[who]);
    if (error) throw new Error(`conexão de ${who} recusada: ${error}`);
    return socket;
  };
  const join = (socket: Socket, room: string) => socket.timeout(3000).emitWithAck('room:join', { room }) as Promise<{ ok: boolean; error?: string }>;
  const nextEvent = <T = any>(socket: Socket, event: string, timeout = 3000) =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`sem ${event} em ${timeout}ms`)), timeout);
      socket.once(event, (payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  /** Coleta tudo o que chega de um evento durante a janela (para afirmar que NADA chegou). */
  const collect = (socket: Socket, event: string) => {
    const received: any[] = [];
    socket.on(event, (payload) => received.push(payload));
    return received;
  };
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const asClient = (clientId: string, method: 'post' | 'patch', path: string, who: string, body?: object) => request(server())[method](path).set('Authorization', `Bearer ${tokens[who]}`).set('X-Client-Id', clientId).send(body ?? {});
  const boardRoom = (orgId: string) => `marketing-board:${orgId}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [TestAppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
    await app.listen(0);
    url = `http://localhost:${(app.getHttpServer().address() as { port: number }).port}`;

    dataSource = app.get(DataSource);
    orgRepo = moduleFixture.get(getRepositoryToken(Organization));
    userRepo = moduleFixture.get(getRepositoryToken(User));
    const profileRepo: Repository<Profile> = moduleFixture.get(getRepositoryToken(Profile));

    await cleanOrg(CNPJ_A);
    await cleanOrg(CNPJ_B);
    if (!(await profileRepo.findOne({ where: { name: 'VOLUNTEER' } }))) {
      await profileRepo.save([{ name: 'ADMIN' }, { name: 'FINANCIAL' }, { name: 'VOLUNTEER' }]);
    }
    orgA = (await orgRepo.save({ legalName: 'Org Realtime A', cnpj: CNPJ_A })).id;
    orgB = (await orgRepo.save({ legalName: 'Org Realtime B', cnpj: CNPJ_B })).id;

    await createUser(orgA, 'admina', '73000000001', 'ADMIN');
    await createUser(orgA, 'editor', '73000000002', { [Screen.MARKETING]: AccessLevel.EDIT });
    await createUser(orgA, 'editor2', '73000000003', { [Screen.MARKETING]: AccessLevel.EDIT });
    await createUser(orgA, 'viewer', '73000000004', { [Screen.MARKETING]: AccessLevel.VIEW });
    await createUser(orgA, 'other', '73000000005', { [Screen.PETS]: AccessLevel.EDIT });
    await createUser(orgB, 'adminb', '73000000006', 'ADMIN');
  }, 60000);

  afterAll(async () => {
    sockets.forEach((socket) => socket.close());
    for (const orgId of [orgA, orgB]) {
      await cleanupAccess(app, orgId);
      await userRepo.delete({ organizationId: orgId });
      await orgRepo.delete({ id: orgId });
    }
    await app.close();
  }, 60000);

  // ---------------------------------------------------------------- conexão

  describe('conexão (C10)', () => {
    it('sem token, token inválido ou expirado: recusada no handshake', async () => {
      const jwt = app.get(JwtService);
      const expired = jwt.sign({ sub: ids.admina, organizationId: orgA }, { expiresIn: '-10s' });

      expect((await connect()).error).toBe('UNAUTHORIZED');
      expect((await connect('lixo.lixo.lixo')).error).toBe('UNAUTHORIZED');
      expect((await connect(expired)).error).toBe('TOKEN_EXPIRED');
      expect((await connect(jwt.sign({ foo: 'bar' }))).error).toBe('UNAUTHORIZED');
    });

    it('com token válido conecta e já entra nas rooms da organização e do usuário', async () => {
      const { socket, error } = await connect(tokens.viewer);
      expect(error).toBeUndefined();
      expect(socket.connected).toBe(true);

      // user:<id> e org:<id> são automáticas: refazer o join delas é permitido para o dono, negado para outro
      expect((await join(socket, `org:${orgA}`)).ok).toBe(true);
      expect((await join(socket, `user:${ids.viewer}`)).ok).toBe(true);
      expect((await join(socket, `user:${ids.admina}`)).ok).toBe(false);
      expect((await join(socket, `org:${orgB}`)).ok).toBe(false);
    });

    it('aceita o token no header Authorization', async () => {
      const socket = io(url, { extraHeaders: { Authorization: `Bearer ${tokens.viewer}` }, transports: ['websocket'], reconnection: false, forceNew: true });
      sockets.push(socket);

      await nextEvent(socket, 'connect');
      expect(socket.connected).toBe(true);
    });
  });

  describe('permissão das rooms do quadro', () => {
    it('Visualizar e Editar entram; sem Marketing e outra organização são negados', async () => {
      expect((await join(await connectAs('viewer'), boardRoom(orgA))).ok).toBe(true);
      expect((await join(await connectAs('editor'), boardRoom(orgA))).ok).toBe(true);
      expect((await join(await connectAs('admina'), boardRoom(orgA))).ok).toBe(true);

      expect(await join(await connectAs('other'), boardRoom(orgA))).toMatchObject({ ok: false, error: 'FORBIDDEN' });
      expect((await join(await connectAs('adminb'), boardRoom(orgA))).ok).toBe(false);
      expect((await join(await connectAs('adminb'), boardRoom(orgB))).ok).toBe(true);
      expect((await join(await connectAs('viewer'), 'marketing-board:nao-e-uuid')).ok).toBe(false);
      expect((await join(await connectAs('viewer'), 'sala-qualquer:1')).ok).toBe(false);
    });
  });

  // ---------------------------------------------------------------- eventos

  describe('eventos marketing.* (C11)', () => {
    it('quem tem acesso recebe o evento leve; outra organização e quem não entrou não recebem nada', async () => {
      const viewer = await connectAs('viewer');
      const adminB = await connectAs('adminb');
      const outsider = await connectAs('other');
      await join(viewer, boardRoom(orgA));
      await join(adminB, boardRoom(orgB));
      await join(outsider, boardRoom(orgA));
      const leakedToB = collect(adminB, 'marketing.card.created');
      const leakedToOther = collect(outsider, 'marketing.card.created');
      const listId = (await call('get', '/marketing/lists', 'editor')).body[0].id;

      const received = nextEvent(viewer, 'marketing.card.created');
      const created = await call('post', '/marketing/cards', 'editor', { listId, title: 'Título secreto do card' });
      const event = await received;

      expect(event).toMatchObject({ cardId: created.body.id, listId, version: 1, clientId: null, actor: { id: ids.editor, name: 'Pessoa editor' } });
      expect(event.updatedAt).toBeTruthy();
      expect(event.at).toBeTruthy();
      expect(JSON.stringify(event)).not.toContain('Título secreto');
      await pause(400);
      expect(leakedToB).toEqual([]);
      expect(leakedToOther).toEqual([]);
      ids.card = created.body.id;
      ids.list = listId;
    });

    it('mover, editar, arquivar e restaurar emitem eventos com o que mudou', async () => {
      const viewer = await connectAs('viewer');
      await join(viewer, boardRoom(orgA));
      const lists = (await call('get', '/marketing/lists', 'editor')).body;

      let next = nextEvent(viewer, 'marketing.card.moved');
      await call('patch', `/marketing/cards/${ids.card}/move`, 'editor', { listId: lists[1].id, position: 'last' });
      expect(await next).toMatchObject({ cardId: ids.card, listId: lists[1].id, fromListId: ids.list, afterCardId: null, beforeCardId: null, version: 2, actor: { id: ids.editor } });

      next = nextEvent(viewer, 'marketing.card.updated');
      await call('patch', `/marketing/cards/${ids.card}`, 'editor', { title: 'Novo título', dueDate: '2026-12-01', labelIds: [] });
      const updated = await next;
      expect(updated.version).toBe(3);
      expect(updated.fields).toEqual(expect.arrayContaining(['title', 'dueDate']));
      expect(updated.fields).not.toContain('labels');

      next = nextEvent(viewer, 'marketing.card.archived');
      await call('post', `/marketing/cards/${ids.card}/archive`, 'editor');
      expect(await next).toMatchObject({ cardId: ids.card });

      next = nextEvent(viewer, 'marketing.card.restored');
      await call('post', `/marketing/cards/${ids.card}/restore`, 'admina');
      expect(await next).toMatchObject({ cardId: ids.card, actor: { id: ids.admina } });
    });

    it('subtarefa, anexo, comentário, fila e etiqueta emitem seus eventos', async () => {
      const viewer = await connectAs('viewer');
      await join(viewer, boardRoom(orgA));

      let next = nextEvent(viewer, 'marketing.task.changed');
      const task = await call('post', `/marketing/cards/${ids.card}/tasks`, 'editor', { title: 'Subtarefa' });
      expect(await next).toMatchObject({ cardId: ids.card, taskId: task.body.id, action: 'created' });

      next = nextEvent(viewer, 'marketing.attachment.changed');
      const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('x')]);
      const upload = await request(server()).post(`/marketing/cards/${ids.card}/attachments`).set('Authorization', `Bearer ${tokens.editor}`).attach('files', png, { filename: 'a.png', contentType: 'image/png' });
      expect(await next).toMatchObject({ cardId: ids.card, action: 'added', attachmentIds: [upload.body[0].id] });

      next = nextEvent(viewer, 'marketing.comment.changed');
      const comment = await call('post', `/marketing/cards/${ids.card}/comments`, 'editor', { body: 'Oi' });
      expect(await next).toMatchObject({ cardId: ids.card, commentId: comment.body.id, action: 'created' });

      next = nextEvent(viewer, 'marketing.list.changed');
      const list = await call('post', '/marketing/lists', 'admina', { name: 'Fila nova', color: '#123' });
      expect(await next).toMatchObject({ listId: list.body.id, action: 'created', actor: { id: ids.admina } });

      next = nextEvent(viewer, 'marketing.label.changed');
      const label = await call('post', '/marketing/labels', 'admina', { name: 'Etiqueta nova', color: '#123' });
      expect(await next).toMatchObject({ labelId: label.body.id, action: 'created' });
      await call('delete', `/marketing/lists/${list.body.id}`, 'admina');
    });

    it('permissão revogada: na próxima emissão sai da room (room:revoked), não recebe o evento e o rejoin é negado', async () => {
      const viewer = await connectAs('viewer');
      await join(viewer, boardRoom(orgA));
      const events = collect(viewer, 'marketing.card.created');

      await app.get(TeamService).setPermissions(teamIds.viewer, {});
      const revoked = nextEvent(viewer, 'room:revoked');
      await call('post', '/marketing/cards', 'editor', { listId: ids.list, title: 'Depois da revogação' });

      expect(await revoked).toEqual({ room: boardRoom(orgA) });
      await pause(300);
      expect(events).toEqual([]);
      expect((await join(viewer, boardRoom(orgA))).ok).toBe(false);

      // e a próxima emissão nem tenta entregar: continua fora
      await call('post', '/marketing/cards', 'editor', { listId: ids.list, title: 'Mais um' });
      await pause(300);
      expect(events).toEqual([]);
      await app.get(TeamService).setPermissions(teamIds.viewer, { [Screen.MARKETING]: AccessLevel.VIEW });
      expect((await join(viewer, boardRoom(orgA))).ok).toBe(true);
    });
  });

  describe('eco do próprio cliente e vizinhos no move', () => {
    it('o X-Client-Id da requisição volta no evento (e é null sem o header ou com valor inválido)', async () => {
      const viewer = await connectAs('viewer');
      await join(viewer, boardRoom(orgA));

      let next = nextEvent(viewer, 'marketing.card.created');
      await asClient('aba-123', 'post', '/marketing/cards', 'editor', { listId: ids.list, title: 'Com cliente' });
      expect((await next).clientId).toBe('aba-123');

      next = nextEvent(viewer, 'marketing.card.created');
      await asClient('x y/<script>', 'post', '/marketing/cards', 'editor', { listId: ids.list, title: 'Cliente inválido' });
      expect((await next).clientId).toBeNull();
    });

    it('card.moved traz a fila, os vizinhos pedidos e a versão', async () => {
      const viewer = await connectAs('viewer');
      await join(viewer, boardRoom(orgA));
      const a = (await call('post', '/marketing/cards', 'editor', { listId: ids.list, title: 'Vizinho A' })).body.id;
      const b = (await call('post', '/marketing/cards', 'editor', { listId: ids.list, title: 'Vizinho B' })).body.id;
      const mover = (await call('post', '/marketing/cards', 'editor', { listId: ids.list, title: 'Movido' })).body.id;
      await pause(200);

      const next = nextEvent(viewer, 'marketing.card.moved');
      await asClient('aba-9', 'patch', `/marketing/cards/${mover}/move`, 'editor', { listId: ids.list, afterCardId: a, beforeCardId: b });
      const event = await next;

      expect(event).toMatchObject({ cardId: mover, listId: ids.list, afterCardId: a, beforeCardId: b, clientId: 'aba-9', fromListId: ids.list });
      // mesma fila: reordenar não muda a versão
      expect(event.version).toBe(1);
    });

    it('alteração de campos do card publica fields e a nova version', async () => {
      const viewer = await connectAs('viewer');
      await join(viewer, boardRoom(orgA));
      const cardId = (await call('post', '/marketing/cards', 'editor', { listId: ids.list, title: 'Campos' })).body.id;
      await pause(200);

      const next = nextEvent(viewer, 'marketing.card.updated');
      await call('patch', `/marketing/cards/${cardId}`, 'editor', { description: 'x', memberIds: [ids.editor2] });
      const event = await next;

      expect([...event.fields].sort()).toEqual(['description', 'members']);
      expect(event.version).toBe(2);
    });
  });

  // ---------------------------------------------------------------- token

  describe('expiração do token', () => {
    it('ao vencer avisa (auth:expired); renovar com auth:refresh mantém a conexão; token de outro usuário é recusado', async () => {
      const jwt = app.get(JwtService);
      const shortLived = jwt.sign({ sub: ids.viewer, organizationId: orgA }, { expiresIn: '2s' });
      const { socket, error } = await connect(shortLived);
      expect(error).toBeUndefined();

      const expired = await nextEvent(socket, 'auth:expired', 5000);
      expect(expired.graceMs).toBeGreaterThan(0);

      const foreign = await socket.timeout(3000).emitWithAck('auth:refresh', { token: tokens.admina });
      expect(foreign.ok).toBe(false);
      const refreshed = await socket.timeout(3000).emitWithAck('auth:refresh', { token: tokens.viewer });
      expect(refreshed).toEqual({ ok: true });
      await pause(500);
      expect(socket.connected).toBe(true);
    }, 15000);
  });

  // ---------------------------------------------------------------- notificações

  describe('notificações in-app (C12)', () => {
    let cardId: string;

    beforeAll(async () => {
      const listId = (await call('get', '/marketing/lists', 'editor')).body[0].id;
      cardId = (await call('post', '/marketing/cards', 'editor', { listId, title: 'Card das notificações' })).body.id;
    });

    const mine = async (who: string, query = '') => (await call('get', `/notifications?limit=100${query}`, who)).body;
    const count = async (who: string) => (await mine(who)).items.length;

    it('sem token: 401; usuário sem notificações recebe lista vazia, sem próxima página', async () => {
      expect((await request(server()).get('/notifications')).status).toBe(401);
      expect(await mine('other')).toEqual({ items: [], unreadCount: 0, nextCursor: null });
    });

    it('adicionado como membro: o adicionado recebe (em tempo real e na lista) com título e corpo prontos; o autor não', async () => {
      const unreadBefore = (await mine('editor2')).unreadCount;
      const editor2 = await connectAs('editor2');
      const received = nextEvent(editor2, 'notification.created');

      await call('patch', `/marketing/cards/${cardId}`, 'editor', { memberIds: [ids.editor2, ids.editor] });
      const event = await received;

      expect(event.unreadCount).toBe(unreadBefore + 1);
      expect(event.notification).toMatchObject({ type: 'MARKETING_MEMBER_ADDED', link: `/marketing?card=${cardId}`, isRead: false, body: 'Você agora acompanha este card.' });
      expect(event.notification.title).toBe('Pessoa editor adicionou você ao card "Card das notificações"');
      expect(await count('editor')).toBe(0);
      expect((await mine('editor2')).unreadCount).toBe(unreadBefore + 1);
    });

    it('comentário com menção de um membro: 1 notificação de menção (sem duplicar com a de comentário); o autor não recebe', async () => {
      const before = await count('editor2');

      await call('post', `/marketing/cards/${cardId}/comments`, 'admina', { body: 'Pode ver @Pessoa editor2 ?', mentionUserIds: [ids.editor2] });

      const editor2 = await mine('editor2');
      expect(editor2.items).toHaveLength(before + 1);
      expect(editor2.items[0]).toMatchObject({ type: 'MARKETING_MENTION', title: 'Pessoa admina mencionou você em "Card das notificações"', body: 'Pode ver @Pessoa editor2 ?' });
      // o outro membro (editor) recebe como comentário novo
      expect((await mine('editor')).items.map((n) => n.type)).toEqual(['MARKETING_COMMENT']);
      expect(await count('admina')).toBe(0);
    });

    it('editar o comentário notifica só quem passou a ser mencionado', async () => {
      const comments = (await call('get', `/marketing/cards/${cardId}/comments`, 'admina')).body.data;
      const before = { editor2: await count('editor2'), editor: await count('editor') };

      await call('patch', `/marketing/cards/${cardId}/comments/${comments[0].id}`, 'admina', {
        body: 'Pode ver @Pessoa editor2 e @Pessoa editor ?',
        mentionUserIds: [ids.editor2, ids.editor],
      });

      expect(await count('editor2')).toBe(before.editor2);
      const editor = await mine('editor');
      expect(editor.items).toHaveLength(before.editor + 1);
      expect(editor.items[0].type).toBe('MARKETING_MENTION');
    });

    it('card movido de fila: avisa os membros, menos quem moveu; reordenar na mesma fila não notifica', async () => {
      const lists = (await call('get', '/marketing/lists', 'editor')).body;
      const before = { editor2: await count('editor2'), editor: await count('editor') };

      await call('patch', `/marketing/cards/${cardId}/move`, 'editor', { listId: lists[2].id, position: 'last' });

      const editor2 = await mine('editor2');
      expect(editor2.items).toHaveLength(before.editor2 + 1);
      expect(editor2.items[0]).toMatchObject({
        type: 'MARKETING_CARD_MOVED',
        title: `Pessoa editor moveu "Card das notificações" de ${lists[0].name} para ${lists[2].name}`,
        body: `Fila atual: ${lists[2].name}.`,
        metadata: expect.objectContaining({ cardId, toListId: lists[2].id }),
      });
      expect(await count('editor')).toBe(before.editor);
      await call('patch', `/marketing/cards/${cardId}/move`, 'editor', { listId: lists[2].id, position: 'last' });
      expect(await count('editor2')).toBe(before.editor2 + 1);
    });

    it('quem perdeu o acesso ao Marketing não recebe notificação de card', async () => {
      const teamId = (await dataSource.query('SELECT team_id FROM volunteers WHERE user_id = $1', [ids.editor2]))[0].team_id;
      await app.get(TeamService).setPermissions(teamId, {});
      const before = await count('editor2');

      await call('post', `/marketing/cards/${cardId}/comments`, 'admina', { body: 'Sem acesso' });

      expect(await count('editor2')).toBe(before);
      await app.get(TeamService).setPermissions(teamId, { [Screen.MARKETING]: AccessLevel.EDIT });
    });

    it('paginação por cursor: páginas sem repetir nem pular, nextCursor nulo na última; cursor inválido é 400', async () => {
      const all = (await mine('editor2')).items;
      expect(all.length).toBeGreaterThanOrEqual(4);

      const pages: string[][] = [];
      let cursor: string | null = null;
      do {
        const res = await call('get', `/notifications?limit=2${cursor ? `&cursor=${cursor}` : ''}`, 'editor2');
        expect(res.status).toBe(200);
        expect(res.body.items.length).toBeLessThanOrEqual(2);
        pages.push(res.body.items.map((n) => n.id));
        cursor = res.body.nextCursor;
      } while (cursor);

      expect(pages.flat()).toEqual(all.map((n) => n.id));
      expect(pages.length).toBe(Math.ceil(all.length / 2));
      // uma notificação nova entre as páginas não desloca o cursor
      const first = await call('get', '/notifications?limit=2', 'editor2');
      await call('post', `/marketing/cards/${cardId}/comments`, 'admina', { body: 'Nova no meio', mentionUserIds: [ids.editor2] });
      const second = await call('get', `/notifications?limit=2&cursor=${first.body.nextCursor}`, 'editor2');
      expect(second.body.items.map((n) => n.id)).toEqual(all.slice(2, 4).map((n) => n.id));

      expect((await call('get', '/notifications?cursor=lixo', 'editor2')).status).toBe(400);
      expect((await call('get', '/notifications?limit=0', 'editor2')).status).toBe(400);
      expect((await call('get', '/notifications?limit=500', 'editor2')).status).toBe(200);
    });

    it('marcar como lida devolve só unreadCount, é idempotente e sincroniza as outras abas (notification.read)', async () => {
      const tabA = await connectAs('editor2');
      const tabB = await connectAs('editor2');
      const unread = (await mine('editor2', '&unread=true')).items;
      expect(unread.length).toBeGreaterThan(1);
      const target = unread[0];

      const readOnTabB = nextEvent(tabB, 'notification.read');
      const readOnTabA = nextEvent(tabA, 'notification.read');
      const res = await request(server()).patch(`/notifications/${target.id}/read`).set('Authorization', `Bearer ${tokens.editor2}`).set('X-Client-Id', 'aba-A');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ unreadCount: unread.length - 1 });
      expect(await readOnTabB).toEqual({ ids: [target.id], all: false, unreadCount: unread.length - 1, clientId: 'aba-A' });
      expect((await readOnTabA).clientId).toBe('aba-A');
      expect((await call('patch', `/notifications/${target.id}/read`, 'editor2')).body).toEqual({ unreadCount: unread.length - 1 });

      const stillUnread = await mine('editor2', '&unread=true');
      expect(stillUnread.items).toHaveLength(unread.length - 1);
      expect(stillUnread.items.every((n) => !n.isRead)).toBe(true);
      expect((await call('get', '/notifications?unread=talvez', 'editor2')).status).toBe(400);
    });

    it('POST /notifications/read-all marca todas, devolve unreadCount 0 e emite notification.read all', async () => {
      const tab = await connectAs('editor2');
      const synced = nextEvent(tab, 'notification.read');

      const res = await call('post', '/notifications/read-all', 'editor2');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ unreadCount: 0 });
      expect(await synced).toMatchObject({ ids: null, all: true, unreadCount: 0 });
      expect((await mine('editor2')).unreadCount).toBe(0);
      expect((await mine('editor2', '&unread=true')).items).toEqual([]);
      expect((await call('patch', '/notifications/read-all', 'editor2')).status).toBeGreaterThanOrEqual(400);
    });

    it('só do próprio usuário: ler a notificação de outro é 404 e read-all não mexe nas dos outros', async () => {
      const editorNotifications = (await mine('editor')).items;
      expect(editorNotifications.length).toBeGreaterThan(0);
      const unreadBefore = (await mine('editor')).unreadCount;
      expect(unreadBefore).toBeGreaterThan(0);

      expect((await call('patch', `/notifications/${editorNotifications[0].id}/read`, 'editor2')).status).toBe(404);
      expect((await call('patch', `/notifications/${editorNotifications[0].id}/read`, 'adminb')).status).toBe(404);
      await call('post', '/notifications/read-all', 'editor2');
      expect((await mine('editor')).unreadCount).toBe(unreadBefore);
      expect((await call('patch', '/notifications/nao-e-uuid/read', 'editor')).status).toBe(400);
    });

    it('a notificação em tempo real só chega ao dono (isolamento entre usuários e organizações)', async () => {
      const editor = await connectAs('editor');
      const adminB = await connectAs('adminb');
      const leaked = collect(adminB, 'notification.created');
      const own = nextEvent(editor, 'notification.created');

      await call('patch', `/marketing/cards/${cardId}`, 'admina', { memberIds: [ids.editor2] });
      await call('patch', `/marketing/cards/${cardId}`, 'admina', { memberIds: [ids.editor2, ids.editor] });
      expect((await own).notification.type).toBe('MARKETING_MEMBER_ADDED');
      await pause(300);

      expect(leaked).toEqual([]);
    });
  });
});
