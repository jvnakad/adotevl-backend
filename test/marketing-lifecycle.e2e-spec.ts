import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { TestAppModule, cleanupAccess, cleanupMarketing, joinTeam } from './test-app.module';
import { Profile } from '../src/profile/profile.entity';
import { Organization } from '../src/organization/organization.entity';
import { User } from '../src/user/user.entity';
import { AccessLevel, Screen } from '../src/access/access';
import { TeamService } from '../src/team/team.service';
import { TeamSystemKey } from '../src/team/team.entity';
import { MarketingListService } from '../src/marketing/marketing-list.service';
import { todayInBrazil, addDays } from '../src/volunteer-schedule/schedule-time';

// Conteúdos mínimos com a assinatura real de cada tipo (o servidor confere o conteúdo, não o Content-Type)
const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('dados')]);
const PDF_BYTES = Buffer.from('%PDF-1.7\n%fim');
const DOCX_BYTES = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('....word/document.xml....')]);
const mp4Bytes = (size: number) => {
  const buffer = Buffer.alloc(size);
  buffer.write('ftyp', 4, 'latin1');
  buffer.write('isom', 8, 'latin1');
  return buffer;
};

describe('Marketing (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let orgRepo: Repository<Organization>;
  let userRepo: Repository<User>;
  let orgA: string;
  let orgB: string;
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const server = () => app.getHttpServer();
  const call = (method: 'get' | 'post' | 'patch' | 'delete', path: string, who: string, body?: object) => {
    const req = request(server())[method](path).set('Authorization', `Bearer ${tokens[who]}`);
    return body ? req.send(body) : req;
  };
  const login = async (email: string) => (await request(server()).post('/auth/login').send({ email, password: 'senha123' })).body.access_token;

  const CNPJ_A = '93939393939393';
  const CNPJ_B = '94949494949494';

  async function cleanOrg(cnpj: string) {
    const existing = await orgRepo.findOne({ where: { cnpj } });
    if (!existing) return;
    await cleanupMarketing(app, existing.id);
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
      email: `${key}.marketing@teste.com`,
      password: await bcrypt.hash('senha123', 10),
      profileId: profile.id,
      organizationId,
      isConfirmed: true,
      isApproved: true,
      isActive: true,
    });
    await joinTeam(app, user, access);
    ids[key] = user.id;
    tokens[key] = await login(`${key}.marketing@teste.com`);
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [TestAppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
    // Servidor escutando de verdade: sem isso o supertest abre uma porta por requisicao e, com muitas em paralelo, o CI derruba conexoes (ECONNRESET)
    await app.listen(0);

    dataSource = app.get(DataSource);
    orgRepo = moduleFixture.get(getRepositoryToken(Organization));
    userRepo = moduleFixture.get(getRepositoryToken(User));
    const profileRepo: Repository<Profile> = moduleFixture.get(getRepositoryToken(Profile));

    await cleanOrg(CNPJ_A);
    await cleanOrg(CNPJ_B);
    if (!(await profileRepo.findOne({ where: { name: 'VOLUNTEER' } }))) {
      await profileRepo.save([{ name: 'ADMIN' }, { name: 'FINANCIAL' }, { name: 'VOLUNTEER' }]);
    }
    orgA = (await orgRepo.save({ legalName: 'Org Marketing A', cnpj: CNPJ_A })).id;
    orgB = (await orgRepo.save({ legalName: 'Org Marketing B', cnpj: CNPJ_B })).id;

    await createUser(orgA, 'admina', '72000000001', 'ADMIN');
    await createUser(orgA, 'editor', '72000000002', { [Screen.MARKETING]: AccessLevel.EDIT });
    await createUser(orgA, 'editor2', '72000000003', { [Screen.MARKETING]: AccessLevel.EDIT });
    await createUser(orgA, 'viewer', '72000000004', { [Screen.MARKETING]: AccessLevel.VIEW });
    await createUser(orgA, 'other', '72000000005', { [Screen.PETS]: AccessLevel.EDIT });
    await createUser(orgB, 'adminb', '72000000006', 'ADMIN');
  }, 60000);

  afterAll(async () => {
    for (const orgId of [orgA, orgB]) {
      await cleanupMarketing(app, orgId);
      await cleanupAccess(app, orgId);
      await userRepo.delete({ organizationId: orgId });
      await orgRepo.delete({ id: orgId });
    }
    await app.close();
  }, 60000);

  const eventsOf = (cardId: string) => dataSource.query('SELECT type, from_list_name, to_list_name, metadata, user_name FROM marketing_history_events WHERE card_id = $1 ORDER BY created_at, id', [cardId]);
  const typesOf = async (cardId: string) => (await eventsOf(cardId)).map((event) => event.type);
  const board = async (who = 'admina') => (await call('get', '/marketing/board', who)).body;
  const listNamed = async (name: string, who = 'admina') => (await board(who)).lists.find((list) => list.name === name);

  // ---------------------------------------------------------------- permissões

  describe('permissões', () => {
    const someId = '3f0c2b1e-6a52-4f0e-9a43-0f6f4b7a1c11';

    it('sem token: 401', async () => {
      expect((await request(server()).get('/marketing/board')).status).toBe(401);
    });

    it('usuário sem acesso a Marketing recebe 403 em leituras e escritas', async () => {
      const results = await Promise.all([
        call('get', '/marketing/board', 'other'),
        call('get', '/marketing/members', 'other'),
        call('get', '/marketing/lists', 'other'),
        call('get', '/marketing/labels', 'other'),
        call('get', '/marketing/cards', 'other'),
        call('get', '/marketing/calendar?from=2026-11-01&to=2026-11-30', 'other'),
        call('post', '/marketing/cards', 'other', {}),
        call('get', `/marketing/cards/${someId}/history`, 'other'),
      ]);
      expect(results.map((r) => r.status)).toEqual(Array(8).fill(403));
    });

    it('Visualizar lê, mas não cria, move, edita, comenta nem anexa', async () => {
      expect((await call('get', '/marketing/board', 'viewer')).status).toBe(200);
      expect((await call('get', '/marketing/lists', 'viewer')).status).toBe(200);
      const results = await Promise.all([
        call('post', '/marketing/cards', 'viewer', { listId: someId, title: 'X' }),
        call('patch', `/marketing/cards/${someId}`, 'viewer', { title: 'Y' }),
        call('patch', `/marketing/cards/${someId}/move`, 'viewer', { listId: someId }),
        call('post', `/marketing/cards/${someId}/archive`, 'viewer'),
        call('post', `/marketing/cards/${someId}/tasks`, 'viewer', { title: 'T' }),
        call('post', `/marketing/cards/${someId}/comments`, 'viewer', { body: 'C' }),
        call('post', `/marketing/cards/${someId}/attachments`, 'viewer'),
      ]);
      expect(results.map((r) => r.status)).toEqual(Array(7).fill(403));
    });

    it('Configuração e restauração são só da equipe Admin (Editar não basta)', async () => {
      const results = await Promise.all([
        call('post', '/marketing/lists', 'editor', { name: 'Nova', color: '#FFF' }),
        call('patch', `/marketing/lists/${someId}`, 'editor', { name: 'N' }),
        call('patch', `/marketing/lists/${someId}/move`, 'editor', { index: 0 }),
        call('delete', `/marketing/lists/${someId}`, 'editor'),
        call('post', '/marketing/labels', 'editor', { name: 'L', color: '#FFF' }),
        call('get', `/marketing/labels/${someId}/usage`, 'editor'),
        call('delete', `/marketing/labels/${someId}`, 'editor'),
        call('post', `/marketing/cards/${someId}/restore`, 'editor'),
      ]);
      expect(results.map((r) => r.status)).toEqual(Array(8).fill(403));
    });

    it('a matriz não deixa conceder a Configuração a outra equipe', async () => {
      const teams = app.get(TeamService);
      const team = await teams.create({ name: 'Equipe config', organizationId: orgA });
      await expect(teams.setPermissions(team.id, { [Screen.MARKETING]: AccessLevel.EDIT, [Screen.MARKETING_SETTINGS]: AccessLevel.VIEW })).rejects.toThrow('exclusiva da equipe Admin');
    });
  });

  // ---------------------------------------------------------------- equipe Marketing e elegíveis

  describe('equipe Marketing (C15) e elegíveis', () => {
    it('a organização ganha a equipe Marketing com Marketing Editar e sem Configuração', async () => {
      const teams = app.get(TeamService);
      const team = await teams.systemTeam(orgA, TeamSystemKey.MARKETING);
      const full = await teams.findOne(team.id);

      expect(full.name).toBe('Marketing');
      expect(full.permissions[Screen.MARKETING]).toBe(AccessLevel.EDIT);
      expect(full.permissions[Screen.MARKETING_SETTINGS]).toBe(AccessLevel.NONE);
    });

    it('GET /marketing/members lista só quem tem Editar em Marketing (Admin incluído), A→Z', async () => {
      const res = await call('get', '/marketing/members', 'viewer');

      expect(res.status).toBe(200);
      expect(res.body.map((user) => user.id).sort()).toEqual([ids.admina, ids.editor, ids.editor2].sort());
      expect(res.body.map((user) => user.name)).toEqual([...res.body.map((user) => user.name)].sort());
    });
  });

  // ---------------------------------------------------------------- filas

  describe('filas (C2)', () => {
    it('a organização nasce com as 7 filas padrão, Postado como final, e não recebe de novo', async () => {
      const res = await call('get', '/marketing/lists', 'viewer');

      expect(res.status).toBe(200);
      expect(res.body.map((list) => list.name)).toEqual(['Releases', 'Banco de Ideias', 'Pautas', 'Criação', 'Ajustes', 'Aprovação', 'Postado']);
      expect(res.body.find((list) => list.isFinal).name).toBe('Postado');
      await app.get(MarketingListService).ensureDefaultLists(orgA);
      expect((await call('get', '/marketing/lists', 'viewer')).body).toHaveLength(7);
    });

    it('cria fila (cor #RGB vira #RRGGBB), recusa nome duplicado ignorando acento e maiúscula', async () => {
      const created = await call('post', '/marketing/lists', 'admina', { name: 'Stories', color: '#0af' });
      expect(created.status).toBe(201);
      expect(created.body.color).toBe('#00AAFF');
      ids.listStories = created.body.id;

      const duplicate = await call('post', '/marketing/lists', 'admina', { name: ' CRIAÇÃO ', color: '#000000' });
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.message).toBe('Já existe uma fila com esse nome.');
      expect((await call('post', '/marketing/lists', 'admina', { name: 'x'.repeat(41), color: '#000000' })).status).toBe(400);
      expect((await call('post', '/marketing/lists', 'admina', { name: 'Ok', color: 'azul' })).status).toBe(400);
    });

    it('renomeia, troca cor e reordena (a ordem persiste)', async () => {
      const renamed = await call('patch', `/marketing/lists/${ids.listStories}`, 'admina', { name: 'Reels', color: '#123456' });
      expect(renamed.status).toBe(200);
      expect(renamed.body).toMatchObject({ name: 'Reels', color: '#123456' });

      expect((await call('patch', `/marketing/lists/${ids.listStories}/move`, 'admina', { index: 0 })).status).toBe(200);
      expect((await call('get', '/marketing/lists', 'admina')).body[0].name).toBe('Reels');
    });

    it('fila final: no máximo uma ativa (marcar outra tira a marca da anterior) e é opcional', async () => {
      await call('patch', `/marketing/lists/${ids.listStories}`, 'admina', { isFinal: true });
      let lists = (await call('get', '/marketing/lists', 'admina')).body;
      expect(lists.filter((list) => list.isFinal).map((list) => list.name)).toEqual(['Reels']);

      const posted = lists.find((list) => list.name === 'Postado');
      await call('patch', `/marketing/lists/${posted.id}`, 'admina', { isFinal: true });
      lists = (await call('get', '/marketing/lists', 'admina')).body;
      expect(lists.filter((list) => list.isFinal).map((list) => list.name)).toEqual(['Postado']);

      await call('patch', `/marketing/lists/${posted.id}`, 'admina', { isFinal: false });
      expect((await call('get', '/marketing/lists', 'admina')).body.some((list) => list.isFinal)).toBe(false);
      await call('patch', `/marketing/lists/${posted.id}`, 'admina', { isFinal: true });
    });

    it('fila com card ativo não é excluída (409 com a contagem); vazia é', async () => {
      const pautas = await listNamed('Pautas');
      const card = await call('post', '/marketing/cards', 'editor', { listId: pautas.id, title: 'Card da fila' });
      expect(card.status).toBe(201);
      ids.cardInPautas = card.body.id;

      const blocked = await call('delete', `/marketing/lists/${pautas.id}`, 'admina');
      expect(blocked.status).toBe(409);
      expect(blocked.body.activeCards).toBe(1);

      const removed = await call('delete', `/marketing/lists/${ids.listStories}`, 'admina');
      expect(removed.status).toBe(200);
      expect((await call('get', '/marketing/lists', 'admina')).body.map((list) => list.name)).not.toContain('Reels');
    });

    it('limite de 15 filas ativas', async () => {
      const created: string[] = [];
      for (let i = 0; i < 8; i++) {
        const res = await call('post', '/marketing/lists', 'admina', { name: `Extra ${i}`, color: '#111111' });
        if (res.status === 201) created.push(res.body.id);
      }
      expect((await call('get', '/marketing/lists', 'admina')).body).toHaveLength(15);
      const over = await call('post', '/marketing/lists', 'admina', { name: 'Demais', color: '#111111' });
      expect(over.status).toBe(400);
      expect(over.body.message).toContain('15');
      for (const id of created) await call('delete', `/marketing/lists/${id}`, 'admina');
    });
  });

  // ---------------------------------------------------------------- etiquetas

  describe('etiquetas (C3)', () => {
    it('começam vazias; cria, recusa duplicada e edita', async () => {
      expect((await call('get', '/marketing/labels', 'viewer')).body).toEqual([]);
      const created = await call('post', '/marketing/labels', 'admina', { name: 'Instagram', color: '#e1306c' });
      expect(created.status).toBe(201);
      expect(created.body.color).toBe('#E1306C');
      ids.labelIg = created.body.id;

      const duplicate = await call('post', '/marketing/labels', 'admina', { name: 'INSTAGRAM', color: '#000' });
      expect(duplicate.status).toBe(409);
      expect((await call('post', '/marketing/labels', 'admina', { name: 'x'.repeat(31), color: '#000' })).status).toBe(400);

      const edited = await call('patch', `/marketing/labels/${ids.labelIg}`, 'admina', { color: '#111' });
      expect(edited.body.color).toBe('#111111');
      ids.labelUrgent = (await call('post', '/marketing/labels', 'admina', { name: 'Urgente', color: '#DC2626' })).body.id;
    });

    it('excluir etiqueta mostra o uso, remove dos cards e registra ETIQUETA_REMOVIDA (reason LABEL_DELETED)', async () => {
      const patched = await call('patch', `/marketing/cards/${ids.cardInPautas}`, 'editor', { labelIds: [ids.labelIg, ids.labelUrgent] });
      expect(patched.status).toBe(200);
      expect(patched.body.labels.map((label) => label.name)).toEqual(['Instagram', 'Urgente']);

      expect((await call('get', `/marketing/labels/${ids.labelUrgent}/usage`, 'admina')).body.cardCount).toBe(1);
      const removed = await call('delete', `/marketing/labels/${ids.labelUrgent}`, 'admina');
      expect(removed.status).toBe(200);
      expect(removed.body.removedFromCards).toBe(1);

      const detail = await call('get', `/marketing/cards/${ids.cardInPautas}`, 'viewer');
      expect(detail.body.labels.map((label) => label.name)).toEqual(['Instagram']);
      const events = await eventsOf(ids.cardInPautas);
      expect(events.filter((e) => e.type === 'ETIQUETA_REMOVIDA').map((e) => e.metadata.reason)).toEqual(['LABEL_DELETED']);
      // nome liberado depois do soft delete
      expect((await call('post', '/marketing/labels', 'admina', { name: 'Urgente', color: '#DC2626' })).status).toBe(201);
    });

    it('etiqueta excluída ou de outra organização não pode ser aplicada', async () => {
      const labelB = (await call('post', '/marketing/labels', 'adminb', { name: 'Da B', color: '#000' })).body.id;
      expect((await call('patch', `/marketing/cards/${ids.cardInPautas}`, 'editor', { labelIds: [labelB] })).status).toBe(400);
      expect((await call('patch', `/marketing/cards/${ids.cardInPautas}`, 'editor', { labelIds: [ids.labelUrgent] })).status).toBe(400);
    });
  });

  // ---------------------------------------------------------------- cards, quadro, movimento

  describe('quadro e movimento (C4)', () => {
    let criacao: any;
    let ajustes: any;
    const cardIds: string[] = [];

    it('cria cards no fim da fila com position esparsa e evento CARD_CRIADO', async () => {
      criacao = await listNamed('Criação');
      ajustes = await listNamed('Ajustes');
      for (const title of ['A', 'B', 'C']) {
        const res = await call('post', '/marketing/cards', 'editor', { listId: criacao.id, title });
        expect(res.status).toBe(201);
        cardIds.push(res.body.id);
      }
      const cards = (await listNamed('Criação')).cards;
      expect(cards.map((card) => card.title)).toEqual(['A', 'B', 'C']);
      expect(cards.map((card) => card.position)).toEqual([1024, 2048, 3072]);
      const events = await eventsOf(cardIds[0]);
      expect(events[0]).toMatchObject({ type: 'CARD_CRIADO', to_list_name: 'Criação', user_name: 'Pessoa editor' });
    });

    it('título obrigatório, fila de outra organização ou inexistente é recusada', async () => {
      expect((await call('post', '/marketing/cards', 'editor', { listId: criacao.id, title: '   ' })).status).toBe(400);
      const listB = (await call('get', '/marketing/lists', 'adminb')).body[0];
      expect((await call('post', '/marketing/cards', 'editor', { listId: listB.id, title: 'X' })).status).toBe(400);
    });

    it('mover para o início da mesma fila usa o ponto médio e NÃO gera evento', async () => {
      const res = await call('patch', `/marketing/cards/${cardIds[2]}/move`, 'editor', { listId: criacao.id, beforeCardId: cardIds[0] });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ position: 512, renumbered: false });
      expect((await listNamed('Criação')).cards.map((card) => card.title)).toEqual(['C', 'A', 'B']);
      expect(await typesOf(cardIds[2])).toEqual(['CARD_CRIADO']);
    });

    it('mover para outra fila grava CARD_MOVIDO (de → para) e persiste fila e ordem', async () => {
      const res = await call('patch', `/marketing/cards/${cardIds[0]}/move`, 'editor', { listId: ajustes.id });

      expect(res.body).toMatchObject({ listId: ajustes.id, position: 1024 });
      expect((await listNamed('Ajustes')).cards.map((card) => card.title)).toEqual(['A']);
      const events = await eventsOf(cardIds[0]);
      expect(events[events.length - 1]).toMatchObject({ type: 'CARD_MOVIDO', from_list_name: 'Criação', to_list_name: 'Ajustes', user_name: 'Pessoa editor' });
    });

    it('sem espaço entre vizinhos renumera a fila e mantém a ordem pedida', async () => {
      // dois cards com posições coladas (10 e 11) forçam a renumeração ao inserir entre eles
      const mk = async (title: string) => (await call('post', '/marketing/cards', 'editor', { listId: ajustes.id, title })).body.id;
      const x = await mk('X');
      const y = await mk('Y');
      const z = await mk('Z');
      await dataSource.query('UPDATE marketing_cards SET position = 10 WHERE id = $1', [x]);
      await dataSource.query('UPDATE marketing_cards SET position = 11 WHERE id = $1', [y]);
      await dataSource.query('UPDATE marketing_cards SET position = 12 WHERE id = $1', [z]);
      const a = cardIds[0];
      await dataSource.query('UPDATE marketing_cards SET position = 9 WHERE id = $1', [a]);

      const res = await call('patch', `/marketing/cards/${z}/move`, 'editor', { listId: ajustes.id, afterCardId: cardIds[0] });

      expect(res.body.renumbered).toBe(true);
      expect((await listNamed('Ajustes')).cards.map((card) => [card.title, card.position])).toEqual([
        ['A', 1024],
        ['Z', 2048],
        ['X', 3072],
        ['Y', 4096],
      ]);
      for (const id of [x, y, z]) await call('post', `/marketing/cards/${id}/archive`, 'editor');
    });

    it('card de outra organização: 404 ao ler e ao mover', async () => {
      expect((await call('get', `/marketing/cards/${cardIds[0]}`, 'adminb')).status).toBe(404);
      const listB = (await call('get', '/marketing/lists', 'adminb')).body[0];
      expect((await call('patch', `/marketing/cards/${cardIds[0]}/move`, 'adminb', { listId: listB.id })).status).toBe(404);
    });

    it('movimentos simultâneos terminam com posições distintas e todas as filas consistentes', async () => {
      const fila = await listNamed('Pautas');
      const created = await Promise.all(Array.from({ length: 6 }, (_, i) => call('post', '/marketing/cards', 'editor', { listId: fila.id, title: `Par ${i}` })));
      expect(created.every((res) => res.status === 201)).toBe(true);
      await Promise.all(created.map((res) => call('patch', `/marketing/cards/${res.body.id}/move`, 'editor', { listId: fila.id })));

      const positions = (await listNamed('Pautas')).cards.map((card) => card.position);
      expect(new Set(positions).size).toBe(positions.length);
    });
  });

  // ---------------------------------------------------------------- detalhe, membros, datas

  describe('detalhe do card (C5) e datas (C16)', () => {
    let cardId: string;
    let postado: any;

    beforeAll(async () => {
      const lista = await listNamed('Pautas');
      postado = await listNamed('Postado');
      cardId = (await call('post', '/marketing/cards', 'editor', { listId: lista.id, title: 'Detalhe', description: 'Texto' })).body.id;
    });

    it('edita título e descrição: um CARD_EDITADO com de/para; sem mudança real não grava nem gera evento', async () => {
      const res = await call('patch', `/marketing/cards/${cardId}`, 'editor', { title: '  Detalhe   novo ', description: 'Outro texto' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ title: 'Detalhe novo', description: 'Outro texto', updatedByName: 'Pessoa editor' });
      const events = await eventsOf(cardId);
      expect(events[events.length - 1].metadata.fields).toEqual([
        { field: 'title', label: 'Título', before: 'Detalhe', after: 'Detalhe novo' },
        { field: 'description', label: 'Descrição', before: 'Texto', after: 'Outro texto' },
      ]);

      const before = (await eventsOf(cardId)).length;
      await call('patch', `/marketing/cards/${cardId}`, 'editor', { title: 'Detalhe novo', description: 'Outro texto' });
      expect((await eventsOf(cardId)).length).toBe(before);
      expect((await call('patch', `/marketing/cards/${cardId}`, 'editor', { title: null })).status).toBe(400);
      expect((await call('patch', `/marketing/cards/${cardId}`, 'editor', { title: 'a'.repeat(251) })).status).toBe(400);
    });

    it('mover não conta como edição (updatedBy continua nulo em card nunca editado)', async () => {
      const novo = (await call('post', '/marketing/cards', 'editor', { listId: postado.id, title: 'Nunca editado' })).body.id;
      const lista = await listNamed('Pautas');
      await call('patch', `/marketing/cards/${novo}/move`, 'editor', { listId: lista.id });

      const detail = await call('get', `/marketing/cards/${novo}`, 'viewer');
      expect(detail.body.updatedBy).toBeNull();
    });

    it('troca de fila pelo detalhe vai para o fim e gera CARD_MOVIDO', async () => {
      const res = await call('patch', `/marketing/cards/${cardId}`, 'editor', { listId: (await listNamed('Aprovação')).id });

      expect(res.body.list.name).toBe('Aprovação');
      expect((await eventsOf(cardId)).pop()).toMatchObject({ type: 'CARD_MOVIDO', to_list_name: 'Aprovação' });
    });

    it('membros: só elegíveis entram; evento de adição e remoção; quem perdeu o Editar continua mas não volta', async () => {
      const bad = await call('patch', `/marketing/cards/${cardId}`, 'editor', { memberIds: [ids.viewer] });
      expect(bad.status).toBe(400);
      expect((await call('patch', `/marketing/cards/${cardId}`, 'editor', { memberIds: [ids.other] })).status).toBe(400);

      const ok = await call('patch', `/marketing/cards/${cardId}`, 'editor', { memberIds: [ids.editor, ids.editor2] });
      expect(ok.body.members.map((m) => m.id).sort()).toEqual([ids.editor, ids.editor2].sort());

      // editor2 perde o Editar (equipe passa a só Visualizar)
      const teamId = (await dataSource.query('SELECT team_id FROM volunteers WHERE user_id = $1', [ids.editor2]))[0].team_id;
      await app.get(TeamService).setPermissions(teamId, { [Screen.MARKETING]: AccessLevel.VIEW });
      const kept = await call('patch', `/marketing/cards/${cardId}`, 'editor', { memberIds: [ids.editor, ids.editor2], title: 'Detalhe novo 2' });
      expect(kept.status).toBe(200);
      expect(kept.body.members).toHaveLength(2);

      const removed = await call('patch', `/marketing/cards/${cardId}`, 'editor', { memberIds: [ids.editor] });
      expect(removed.body.members.map((m) => m.id)).toEqual([ids.editor]);
      expect((await call('patch', `/marketing/cards/${cardId}`, 'editor', { memberIds: [ids.editor, ids.editor2] })).status).toBe(400);

      const types = await typesOf(cardId);
      expect(types.filter((t) => t === 'MEMBRO_ADICIONADO')).toHaveLength(2);
      expect(types.filter((t) => t === 'MEMBRO_REMOVIDO')).toHaveLength(1);
      await app.get(TeamService).setPermissions(teamId, { [Screen.MARKETING]: AccessLevel.EDIT });
    });

    it('datas: DATAS_ALTERADAS com de/para; título + prazo no mesmo save gravam os dois eventos; null limpa', async () => {
      const res = await call('patch', `/marketing/cards/${cardId}`, 'editor', { dueDate: '2026-12-01', publishDate: '2026-12-05', title: 'Com datas' });
      expect(res.body).toMatchObject({ dueDate: '2026-12-01', publishDate: '2026-12-05' });
      const events = await eventsOf(cardId);
      const dates = events.filter((e) => e.type === 'DATAS_ALTERADAS').pop();
      expect(dates.metadata.fields).toEqual([
        { field: 'dueDate', label: 'Prazo de entrega', before: null, after: '2026-12-01' },
        { field: 'publishDate', label: 'Data de publicação', before: null, after: '2026-12-05' },
      ]);

      await call('patch', `/marketing/cards/${cardId}`, 'editor', { publishDate: null });
      const cleared = (await eventsOf(cardId)).filter((e) => e.type === 'DATAS_ALTERADAS').pop();
      expect(cleared.metadata.fields).toEqual([{ field: 'publishDate', label: 'Data de publicação', before: '2026-12-05', after: null }]);
      expect((await call('patch', `/marketing/cards/${cardId}`, 'editor', { dueDate: '2026-02-31' })).status).toBe(400);
    });

    it('atrasado: prazo vencido fora da fila final; na fila final vira done; hoje e futuro não atrasam', async () => {
      const today = todayInBrazil();
      const lista = await listNamed('Pautas');
      const mk = async (title: string, dueDate: string, listId = lista.id) => (await call('post', '/marketing/cards', 'editor', { listId, title, dueDate })).body;

      const late = await mk('Atrasado', addDays(today, -3));
      const now = await mk('Hoje', today);
      const next = await mk('Futuro', addDays(today, 5));
      const done = await mk('Postado velho', addDays(today, -10), postado.id);

      expect(late).toMatchObject({ isOverdue: true, overdueDays: 3, dueStatus: 'overdue' });
      expect(now).toMatchObject({ isOverdue: false, overdueDays: 0, dueStatus: 'today' });
      expect(next).toMatchObject({ isOverdue: false, dueStatus: 'upcoming' });
      expect(done).toMatchObject({ isOverdue: false, overdueDays: 0, dueStatus: 'done' });

      const onBoard = (await board()).lists.flatMap((l) => l.cards).find((c) => c.id === late.id);
      expect(onBoard).toMatchObject({ dueDate: addDays(today, -3), isOverdue: true, overdueDays: 3, dueStatus: 'overdue' });
      ids.cardLate = late.id;
      ids.cardNow = now.id;
      ids.cardNext = next.id;
      ids.cardDone = done.id;
    });

    it('visão Lista: atrasados primeiro, depois prazo crescente, sem prazo por último; limite 100 e filtro without', async () => {
      const res = await call('get', '/marketing/cards?limit=100', 'viewer');
      expect(res.status).toBe(200);
      const order = res.body.data.map((card) => card.id);
      const pos = (id: string) => order.indexOf(id);
      expect(pos(ids.cardLate)).toBeLessThan(pos(ids.cardNow));
      expect(pos(ids.cardNow)).toBeLessThan(pos(ids.cardNext));
      // o card da fila final tem prazo antigo, mas não conta como atrasado: não vem antes dos demais "com prazo" atrasados
      expect(pos(ids.cardLate)).toBeLessThan(pos(ids.cardDone));
      const dueFlags = res.body.data.map((card) => (card.dueDate ? 1 : 2));
      expect([...dueFlags].sort()).toEqual(dueFlags);
      expect(res.body.data[0]).toMatchObject({ list: { name: expect.any(String), color: expect.any(String) }, tasksTotal: expect.any(Number) });

      expect((await call('get', '/marketing/cards?limit=500', 'viewer')).body.limit).toBe(100);
      const noDue = await call('get', '/marketing/cards?without=due&limit=100', 'viewer');
      expect(noDue.body.data.every((card) => card.dueDate === null)).toBe(true);
      expect(noDue.body.total).toBeGreaterThan(0);
      const noPublish = await call('get', '/marketing/cards?without=publish&limit=100', 'viewer');
      expect(noPublish.body.data.every((card) => card.publishDate === null)).toBe(true);
      expect((await call('get', '/marketing/cards?without=x', 'viewer')).status).toBe(400);

      const byTitle = await call('get', '/marketing/cards?sort=title&limit=100', 'viewer');
      const titles = byTitle.body.data.map((card) => card.title.toLowerCase());
      expect(titles).toEqual([...titles].sort());
      expect((await call('get', '/marketing/cards?sort=cor', 'viewer')).status).toBe(400);
      expect((await call('get', '/marketing/cards?page=1&limit=2', 'viewer')).body.data).toHaveLength(2);
    });

    it('calendário: cards do intervalo pela data escolhida e contagem de cards sem a data', async () => {
      const today = todayInBrazil();
      const res = await call('get', `/marketing/calendar?from=${addDays(today, -4)}&to=${addDays(today, 6)}&dateField=due`, 'viewer');

      expect(res.status).toBe(200);
      const found = res.body.cards.map((card) => card.id);
      expect(found).toEqual(expect.arrayContaining([ids.cardLate, ids.cardNow, ids.cardNext]));
      expect(found).not.toContain(ids.cardDone);
      expect(res.body.withoutDateCount).toBeGreaterThan(0);

      const publish = await call('get', `/marketing/calendar?from=${today}&to=${today}&dateField=publish`, 'viewer');
      expect(publish.body.cards).toEqual([]);
      expect(publish.body.withoutDateCount).toBeGreaterThan(res.body.withoutDateCount - 1);

      expect((await call('get', '/marketing/calendar?from=2026-12-01&to=2026-11-01', 'viewer')).status).toBe(400);
      expect((await call('get', '/marketing/calendar?from=2020-01-01&to=2026-11-01', 'viewer')).status).toBe(400);
      expect((await call('get', '/marketing/calendar?from=x&to=y', 'viewer')).status).toBe(400);
    });

    it('arquivar tira do quadro e bloqueia edição; só Admin restaura (fim da fila; fila excluída vai para a primeira ativa)', async () => {
      const lista = await listNamed('Pautas');
      const temp = (await call('post', '/marketing/cards', 'editor', { listId: (await createTempList('Temporária')).id, title: 'Vai arquivar' })).body;

      expect((await call('post', `/marketing/cards/${temp.id}/archive`, 'editor')).status).toBe(201);
      expect((await board()).lists.flatMap((l) => l.cards).some((c) => c.id === temp.id)).toBe(false);
      const blocked = await call('patch', `/marketing/cards/${temp.id}`, 'editor', { title: 'Nope' });
      expect(blocked.status).toBe(409);
      expect(blocked.body).toMatchObject({ code: 'card_archived' });
      expect((await call('get', '/marketing/cards/archived', 'viewer')).body.data.map((c) => c.id)).toContain(temp.id);
      expect((await call('post', `/marketing/cards/${temp.id}/restore`, 'editor')).status).toBe(403);

      // fila excluída enquanto o card está arquivado: restaura no fim da primeira fila ativa
      expect((await call('delete', `/marketing/lists/${temp.listId}`, 'admina')).status).toBe(200);
      const restored = await call('post', `/marketing/cards/${temp.id}/restore`, 'admina');
      expect(restored.status).toBe(201);
      const first = (await call('get', '/marketing/lists', 'admina')).body[0];
      expect(restored.body.listId).toBe(first.id);
      const cardsInFirst = (await listNamed(first.name)).cards;
      expect(cardsInFirst[cardsInFirst.length - 1].id).toBe(temp.id);
      expect(await typesOf(temp.id)).toEqual(['CARD_CRIADO', 'CARD_ARQUIVADO', 'CARD_RESTAURADO']);
      expect((await call('post', `/marketing/cards/${temp.id}/restore`, 'admina')).status).toBe(409);
      expect(lista).toBeDefined();
    });

    async function createTempList(name: string) {
      return (await call('post', '/marketing/lists', 'admina', { name, color: '#222222' })).body;
    }
  });

  // ---------------------------------------------------------------- subtarefas

  describe('subtarefas (C6)', () => {
    let cardId: string;

    beforeAll(async () => {
      cardId = (await call('post', '/marketing/cards', 'editor', { listId: (await listNamed('Releases')).id, title: 'Com checklist' })).body.id;
    });

    it('cria, renomeia, conclui (evento), reordena e exclui; progresso no quadro', async () => {
      const t = [];
      for (const title of ['Um', 'Dois', 'Três']) t.push((await call('post', `/marketing/cards/${cardId}/tasks`, 'editor', { title })).body);
      expect(t.map((task) => task.position)).toEqual([1024, 2048, 3072]);

      expect((await call('patch', `/marketing/cards/${cardId}/tasks/${t[0].id}`, 'editor', { title: 'Um!' })).body.title).toBe('Um!');
      const done = await call('patch', `/marketing/cards/${cardId}/tasks/${t[0].id}`, 'editor', { isDone: true });
      expect(done.body).toMatchObject({ isDone: true, doneBy: ids.editor });
      expect(done.body.doneAt).toBeTruthy();
      expect(await typesOf(cardId)).toContain('SUBTAREFA_CONCLUIDA');

      const cardOnBoard = (await board()).lists.flatMap((l) => l.cards).find((c) => c.id === cardId);
      expect(cardOnBoard).toMatchObject({ tasksTotal: 3, tasksDone: 1 });

      const undone = await call('patch', `/marketing/cards/${cardId}/tasks/${t[0].id}`, 'editor', { isDone: false });
      expect(undone.body).toMatchObject({ isDone: false, doneAt: null, doneBy: null });
      expect((await typesOf(cardId)).filter((x) => x === 'SUBTAREFA_CONCLUIDA')).toHaveLength(1);

      await call('patch', `/marketing/cards/${cardId}/tasks/${t[2].id}/move`, 'editor', { index: 0 });
      expect((await call('get', `/marketing/cards/${cardId}/tasks`, 'viewer')).body.map((task) => task.title)).toEqual(['Três', 'Um!', 'Dois']);

      expect((await call('delete', `/marketing/cards/${cardId}/tasks/${t[1].id}`, 'editor')).status).toBe(200);
      expect((await call('get', `/marketing/cards/${cardId}`, 'viewer')).body.tasks).toHaveLength(2);
    });

    it('responsável só entre elegíveis; prazo opcional; texto obrigatório', async () => {
      expect((await call('post', `/marketing/cards/${cardId}/tasks`, 'editor', { title: 'X', assigneeId: ids.other })).status).toBe(400);
      const ok = await call('post', `/marketing/cards/${cardId}/tasks`, 'editor', { title: 'Y', assigneeId: ids.editor, dueDate: '2026-12-10' });
      expect(ok.body).toMatchObject({ assignee: { id: ids.editor, name: 'Pessoa editor' }, dueDate: '2026-12-10' });
      expect((await call('post', `/marketing/cards/${cardId}/tasks`, 'editor', { title: ' ' })).status).toBe(400);
    });
  });

  // ---------------------------------------------------------------- anexos

  describe('anexos (C7)', () => {
    let cardId: string;
    let png: any;

    beforeAll(async () => {
      cardId = (await call('post', '/marketing/cards', 'editor', { listId: (await listNamed('Releases')).id, title: 'Com anexos' })).body.id;
    });

    const upload = (who: string, files: { name: string; type: string; data: Buffer }[]) => {
      const req = request(server()).post(`/marketing/cards/${cardId}/attachments`).set('Authorization', `Bearer ${tokens[who]}`);
      for (const file of files) req.attach('files', file.data, { filename: file.name, contentType: file.type });
      return req;
    };

    it('anexa imagem e PDF: caminho com prefixo marketing/<org>/<card>/, URL assinada, contador no quadro e eventos', async () => {
      const res = await upload('editor', [
        { name: 'arte.png', type: 'image/png', data: PNG_BYTES },
        { name: 'roteiro.pdf', type: 'application/pdf', data: PDF_BYTES },
      ]);

      expect(res.status).toBe(201);
      expect(res.body).toHaveLength(2);
      expect(res.body[0]).toMatchObject({ fileName: 'arte.png', isImage: true, isCover: false });
      expect(res.body[0].url).toContain('https://storage.test/signed/');
      const rows = await dataSource.query('SELECT storage_path FROM marketing_card_attachments WHERE card_id = $1', [cardId]);
      expect(rows.every((r) => r.storage_path.startsWith(`marketing/${orgA}/${cardId}/`))).toBe(true);
      png = res.body[0];
      expect((await typesOf(cardId)).filter((t) => t === 'ANEXO_ADICIONADO')).toHaveLength(2);
      const onBoard = (await board()).lists.flatMap((l) => l.cards).find((c) => c.id === cardId);
      expect(onBoard.attachmentsCount).toBe(2);
    });

    it('recusa tipo inválido (SVG, executável) e arquivo acima de 30 MB (413), sem gravar nada', async () => {
      const svg = await upload('editor', [{ name: 'x.svg', type: 'image/svg+xml', data: Buffer.from('<svg/>') }]);
      expect(svg.status).toBe(400);
      const exe = await upload('editor', [{ name: 'x.exe', type: 'application/x-msdownload', data: Buffer.from('MZ') }]);
      expect(exe.status).toBe(400);
      const big = await upload('editor', [{ name: 'grande.mp4', type: 'video/mp4', data: mp4Bytes(30 * 1024 * 1024 + 1) }]);
      expect(big.status).toBe(413);
      expect((await call('get', `/marketing/cards/${cardId}/attachments`, 'viewer')).body).toHaveLength(2);
    });

    it('BUG-02: o tipo vem do conteúdo — SVG/HTML com Content-Type e extensão trocados são recusados e nada é gravado', async () => {
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>');
      const html = Buffer.from('<html><script>alert(1)</script></html>');
      const before = (await dataSource.query('SELECT count(*)::int AS n FROM marketing_card_attachments WHERE card_id = $1', [cardId]))[0].n;

      expect((await upload('editor', [{ name: 'evil.png', type: 'image/png', data: svg }])).status).toBe(400);
      expect((await upload('editor', [{ name: 'evil.pdf', type: 'application/pdf', data: html }])).status).toBe(400);
      expect((await upload('editor', [{ name: 'evil.svg', type: 'image/png', data: PNG_BYTES }])).status).toBe(400);
      expect((await upload('editor', [{ name: 'evil.html', type: 'application/pdf', data: PDF_BYTES }])).status).toBe(400);
      // extensão que não combina com o conteúdo
      const mismatch = await upload('editor', [{ name: 'foto.jpg', type: 'image/jpeg', data: PNG_BYTES }]);
      expect(mismatch.status).toBe(400);
      expect(mismatch.body.message).toContain('a extensão não combina com o conteúdo');
      // um arquivo ruim no lote derruba o lote inteiro
      expect((await upload('editor', [{ name: 'ok.png', type: 'image/png', data: PNG_BYTES }, { name: 'evil.png', type: 'image/png', data: svg }])).status).toBe(400);

      expect((await dataSource.query('SELECT count(*)::int AS n FROM marketing_card_attachments WHERE card_id = $1', [cardId]))[0].n).toBe(before);
    });

    it('BUG-02: extensão do caminho e mimeType gravados saem do conteúdo detectado', async () => {
      const res = await upload('editor', [{ name: 'Foto Final.JPEG', type: 'application/octet-stream', data: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('x')]) }]);

      expect(res.status).toBe(201);
      expect(res.body[0]).toMatchObject({ fileName: 'Foto Final.JPEG', mimeType: 'image/jpeg', isImage: true });
      const row = (await dataSource.query('SELECT storage_path, mime_type FROM marketing_card_attachments WHERE id = $1', [res.body[0].id]))[0];
      expect(row.storage_path).toMatch(/\.jpg$/);
      expect(row.mime_type).toBe('image/jpeg');
      await call('delete', `/marketing/cards/${cardId}/attachments/${res.body[0].id}`, 'editor');
    });

    it('BUG-05: exatamente 30 MB passa; 30 MB + 1 byte é 413', async () => {
      const exact = await upload('editor', [{ name: 'exato.mp4', type: 'video/mp4', data: mp4Bytes(30 * 1024 * 1024) }]);

      expect(exact.status).toBe(201);
      expect(exact.body[0].sizeBytes).toBe(31457280);
      expect((await upload('editor', [{ name: 'passou.mp4', type: 'video/mp4', data: mp4Bytes(30 * 1024 * 1024 + 1) }])).status).toBe(413);
      await call('delete', `/marketing/cards/${cardId}/attachments/${exact.body[0].id}`, 'editor');
    }, 60000);

    it('capa é manual: só imagem do próprio card; remover anexo-capa limpa a capa', async () => {
      const pdf = (await call('get', `/marketing/cards/${cardId}/attachments`, 'viewer')).body.find((a) => !a.isImage);
      expect((await call('patch', `/marketing/cards/${cardId}/cover`, 'editor', { attachmentId: pdf.id })).status).toBe(400);
      expect((await call('get', `/marketing/cards/${cardId}`, 'viewer')).body.coverAttachmentId).toBeNull();

      const set = await call('patch', `/marketing/cards/${cardId}/cover`, 'editor', { attachmentId: png.id });
      expect(set.body.coverAttachmentId).toBe(png.id);
      const onBoard = (await board()).lists.flatMap((l) => l.cards).find((c) => c.id === cardId);
      expect(onBoard.coverUrl).toContain('https://storage.test/signed/');

      expect((await call('delete', `/marketing/cards/${cardId}/attachments/${png.id}`, 'editor')).status).toBe(200);
      expect((await call('get', `/marketing/cards/${cardId}`, 'viewer')).body.coverAttachmentId).toBeNull();
      expect(await typesOf(cardId)).toContain('ANEXO_REMOVIDO');
    });

    it('excluir: quem enviou ou Admin; outro editor recebe 403', async () => {
      const res = await upload('editor', [{ name: 'nota.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', data: DOCX_BYTES }]);
      const attachmentId = res.body[0].id;

      expect((await call('delete', `/marketing/cards/${cardId}/attachments/${attachmentId}`, 'editor2')).status).toBe(403);
      expect((await call('delete', `/marketing/cards/${cardId}/attachments/${attachmentId}`, 'admina')).status).toBe(200);
      expect((await call('delete', `/marketing/cards/${cardId}/attachments/${attachmentId}`, 'admina')).status).toBe(404);
    });
  });

  // ---------------------------------------------------------------- comentários

  describe('comentários (C8)', () => {
    let cardId: string;

    beforeAll(async () => {
      cardId = (await call('post', '/marketing/cards', 'editor', { listId: (await listNamed('Releases')).id, title: 'Com comentários' })).body.id;
    });

    it('comenta com menção: mantém só elegível cujo @Nome está no texto; evento com trecho', async () => {
      const res = await call('post', `/marketing/cards/${cardId}/comments`, 'editor', {
        body: 'Pode subir hoje @Pessoa editor2? Falei com @Pessoa viewer também',
        mentionUserIds: [ids.editor2, ids.viewer, ids.admina],
      });

      expect(res.status).toBe(201);
      // viewer não tem Editar; admina é elegível mas o @Nome não está no texto
      expect(res.body.mentions).toEqual([{ userId: ids.editor2, name: 'Pessoa editor2' }]);
      expect(res.body).toMatchObject({ authorId: ids.editor, authorName: 'Pessoa editor', isEdited: false });
      const events = (await eventsOf(cardId)).filter((e) => e.type === 'COMENTARIO_ADICIONADO');
      expect(events[0].metadata.excerpt).toContain('Pode subir hoje');
      ids.comment = res.body.id;
    });

    it('só o autor edita (marca editado, sem evento); Admin não edita o de outro', async () => {
      const eventsBefore = (await eventsOf(cardId)).length;

      expect((await call('patch', `/marketing/cards/${cardId}/comments/${ids.comment}`, 'editor2', { body: 'Invadindo' })).status).toBe(403);
      expect((await call('patch', `/marketing/cards/${cardId}/comments/${ids.comment}`, 'admina', { body: 'Invadindo' })).status).toBe(403);
      const edited = await call('patch', `/marketing/cards/${cardId}/comments/${ids.comment}`, 'editor', { body: 'Texto novo' });

      expect(edited.status).toBe(200);
      expect(edited.body).toMatchObject({ body: 'Texto novo', isEdited: true, mentions: [] });
      expect((await eventsOf(cardId)).length).toBe(eventsBefore);
    });

    it('lista do mais recente, com contador no quadro; texto vazio ou acima de 2000 é recusado', async () => {
      await call('post', `/marketing/cards/${cardId}/comments`, 'editor2', { body: 'Segundo' });
      const list = await call('get', `/marketing/cards/${cardId}/comments`, 'viewer');

      expect(list.body.data.map((c) => c.body)).toEqual(['Segundo', 'Texto novo']);
      expect((await board()).lists.flatMap((l) => l.cards).find((c) => c.id === cardId).commentsCount).toBe(2);
      const empty = await call('post', `/marketing/cards/${cardId}/comments`, 'editor', { body: '  ' });
      expect(empty.status).toBe(400);
      expect(empty.body.message).toEqual(['Escreva o comentário.']);
      expect((await call('post', `/marketing/cards/${cardId}/comments`, 'editor', { body: 'a'.repeat(2001) })).status).toBe(400);
    });

    it('autor exclui o próprio, outro editor não, Admin exclui qualquer um', async () => {
      const own = (await call('post', `/marketing/cards/${cardId}/comments`, 'editor2', { body: 'Do editor2' })).body.id;

      expect((await call('delete', `/marketing/cards/${cardId}/comments/${own}`, 'editor')).status).toBe(403);
      expect((await call('delete', `/marketing/cards/${cardId}/comments/${own}`, 'admina')).status).toBe(200);
      expect((await call('delete', `/marketing/cards/${cardId}/comments/${ids.comment}`, 'editor')).status).toBe(200);
      expect((await call('get', `/marketing/cards/${cardId}/comments`, 'viewer')).body.data.map((c) => c.body)).toEqual(['Segundo']);
    });
  });

  // ---------------------------------------------------------------- paginação por fila, filtros e movimento por vizinhos

  describe('paginação por fila, filtros (C13) e movimento por vizinhos', () => {
    let paginada: any;
    const byTitle: Record<string, string> = {};
    const pag = (n: number) => `Pag ${String(n).padStart(2, '0')}`;
    const listBoard = async (query = '') => (await call('get', `/marketing/board${query}`, 'viewer')).body.lists.find((l) => l.id === paginada.id);
    const pageTitles = (body: any) => body.data.map((card) => card.title);

    beforeAll(async () => {
      paginada = (await call('post', '/marketing/lists', 'admina', { name: 'Paginada', color: '#333333' })).body;
      for (let n = 1; n <= 25; n++) {
        const res = await call('post', '/marketing/cards', 'editor', { listId: paginada.id, title: pag(n) });
        byTitle[pag(n)] = res.body.id;
      }
      const patch = (n: number, body: object) => call('patch', `/marketing/cards/${byTitle[pag(n)]}`, 'editor', body);
      for (let n = 1; n <= 5; n++) await patch(n, { labelIds: [ids.labelIg] });
      for (let n = 3; n <= 7; n++) await patch(n, { memberIds: [ids.editor] });
      await patch(10, { dueDate: '2026-12-10' });
      await patch(11, { dueDate: '2026-12-20' });
      await patch(12, { publishDate: '2027-01-05' });
    }, 60000);

    it('o quadro traz a primeira página de cada fila (padrão 20) com total e hasMore; limit ajusta e acima de 100 vira 100', async () => {
      const first = await listBoard();
      expect(first.cards).toHaveLength(20);
      expect(first).toMatchObject({ total: 25, hasMore: true });
      expect(first.cards.map((card) => card.title)).toEqual(Array.from({ length: 20 }, (_, i) => pag(i + 1)));

      const small = await listBoard('?limit=5');
      expect(small.cards).toHaveLength(5);
      expect(small).toMatchObject({ total: 25, hasMore: true });
      expect((await call('get', '/marketing/board?limit=500', 'viewer')).status).toBe(200);
      expect((await call('get', '/marketing/board?limit=0', 'viewer')).status).toBe(400);
      // fila sem cards continua no quadro
      const empty = (await call('get', '/marketing/board', 'viewer')).body.lists.find((l) => l.name === 'Banco de Ideias');
      expect(empty).toMatchObject({ total: 0, hasMore: false, cards: [] });
    });

    it('Ver mais: offset/limit completam a fila sem repetir nem pular card', async () => {
      const rest = await call('get', `/marketing/lists/${paginada.id}/cards?offset=20&limit=20`, 'viewer');
      expect(rest.status).toBe(200);
      expect(rest.body).toMatchObject({ total: 25, offset: 20, limit: 20, hasMore: false });
      expect(pageTitles(rest.body)).toEqual([pag(21), pag(22), pag(23), pag(24), pag(25)]);

      const mid = await call('get', `/marketing/lists/${paginada.id}/cards?offset=0&limit=10`, 'viewer');
      expect(mid.body).toMatchObject({ hasMore: true });
      expect(pageTitles(mid.body)).toEqual(Array.from({ length: 10 }, (_, i) => pag(i + 1)));
      expect((await call('get', `/marketing/lists/${paginada.id}/cards?limit=500`, 'viewer')).body.limit).toBe(100);
    });

    it('Ver mais valida offset e limit e a fila: fila de outra organização ou inexistente é 404', async () => {
      expect((await call('get', `/marketing/lists/${paginada.id}/cards?offset=-1`, 'viewer')).status).toBe(400);
      expect((await call('get', `/marketing/lists/${paginada.id}/cards?limit=0`, 'viewer')).status).toBe(400);
      expect((await call('get', `/marketing/lists/${paginada.id}/cards`, 'adminb')).status).toBe(404);
      expect((await call('get', `/marketing/lists/${paginada.id}/cards`, 'other')).status).toBe(403);
    });

    it('q filtra pelo título sem acento nem maiúscula e o total respeita o filtro', async () => {
      expect((await listBoard('?q=pag 1')).total).toBe(10);
      expect((await listBoard('?q=PAG 2')).total).toBe(6);
      const rest = await call('get', `/marketing/lists/${paginada.id}/cards?q=PAG%2012`, 'viewer');
      expect(pageTitles(rest.body)).toEqual([pag(12)]);
      // acento no termo casa com título sem acento
      const accent = await call('post', '/marketing/cards', 'editor', { listId: paginada.id, title: 'Ação de Páscoa' });
      expect((await call('get', `/marketing/lists/${paginada.id}/cards?q=acao%20de%20pascoa`, 'viewer')).body.total).toBe(1);
      await call('post', `/marketing/cards/${accent.body.id}/archive`, 'editor');
    });

    it('etiquetas e membros: qualquer um dentro do filtro (vírgula ou parâmetro repetido), AND entre filtros', async () => {
      expect((await listBoard(`?labelIds=${ids.labelIg}`)).total).toBe(5);
      expect((await listBoard(`?labelIds=${ids.labelIg},${ids.labelUrgent}`)).total).toBe(5);
      expect((await listBoard(`?labelIds=${ids.labelUrgent}`)).total).toBe(0);
      expect((await listBoard(`?memberIds=${ids.editor}`)).total).toBe(5);
      expect((await listBoard(`?memberIds=${ids.editor2}&memberIds=${ids.editor}`)).total).toBe(5);
      expect((await listBoard(`?memberIds=${ids.editor2}`)).total).toBe(0);
      // AND: etiqueta Instagram (1 a 5) + membro editor (3 a 7) + título "pag"
      expect((await listBoard(`?q=pag&labelIds=${ids.labelIg}&memberIds=${ids.editor}`)).total).toBe(3);
      const rest = await call('get', `/marketing/lists/${paginada.id}/cards?labelIds=${ids.labelIg}&memberIds=${ids.editor}`, 'viewer');
      expect(pageTitles(rest.body)).toEqual([pag(3), pag(4), pag(5)]);
    });

    it('listIds restringe às filas; os mesmos filtros valem na Lista', async () => {
      const board = (await call('get', `/marketing/board?listIds=${paginada.id}`, 'viewer')).body.lists;
      expect(board.find((l) => l.id === paginada.id).total).toBe(25);
      expect(board.filter((l) => l.id !== paginada.id).every((l) => l.total === 0)).toBe(true);

      const lista = await call('get', `/marketing/cards?listIds=${paginada.id}&labelIds=${ids.labelIg}&limit=100`, 'viewer');
      expect(lista.body.total).toBe(5);
      expect(lista.body.data.every((card) => card.list.id === paginada.id)).toBe(true);
      expect((await call('get', `/marketing/cards?q=pag&memberIds=${ids.editor}`, 'viewer')).body.total).toBe(5);
    });

    it('datas inclusivas: prazo, publicação e criação (dia de Brasília)', async () => {
      expect((await call('get', '/marketing/cards?q=pag&dueFrom=2026-12-10&dueTo=2026-12-10', 'viewer')).body.total).toBe(1);
      expect((await call('get', '/marketing/cards?q=pag&dueFrom=2026-12-10&dueTo=2026-12-20', 'viewer')).body.total).toBe(2);
      expect((await call('get', '/marketing/cards?q=pag&dueFrom=2026-12-11', 'viewer')).body.total).toBe(1);
      expect((await call('get', '/marketing/cards?q=pag&publishFrom=2027-01-05&publishTo=2027-01-05', 'viewer')).body.total).toBe(1);
      expect((await call('get', '/marketing/cards?q=pag&publishTo=2027-01-04', 'viewer')).body.total).toBe(0);

      const today = todayInBrazil();
      expect((await call('get', `/marketing/cards?q=pag&createdFrom=${today}&createdTo=${today}`, 'viewer')).body.total).toBe(25);
      expect((await call('get', `/marketing/cards?q=pag&createdTo=${addDays(today, -1)}`, 'viewer')).body.total).toBe(0);
      expect((await call('get', `/marketing/cards?q=pag&createdFrom=${addDays(today, 1)}`, 'viewer')).body.total).toBe(0);
      expect((await listBoard('?dueFrom=2026-12-10&dueTo=2026-12-20')).total).toBe(2);
    });

    it('without=due|publish combina com os demais filtros', async () => {
      expect((await call('get', '/marketing/cards?q=pag&without=due', 'viewer')).body.total).toBe(23);
      expect((await call('get', '/marketing/cards?q=pag&without=publish', 'viewer')).body.total).toBe(24);
      expect((await call('get', `/marketing/cards?q=pag&without=due&memberIds=${ids.editor}`, 'viewer')).body.total).toBe(5);
    });

    it('calendário aplica os filtros e a contagem de sem data respeita os filtros', async () => {
      const res = await call('get', '/marketing/calendar?from=2026-12-01&to=2026-12-31&q=pag', 'viewer');
      expect(res.body.cards.map((card) => card.title)).toEqual([pag(10), pag(11)]);
      expect(res.body.cards[0].list).toMatchObject({ color: '#333333', isFinal: false });
      expect(res.body.withoutDateCount).toBe(23);
      const publish = await call('get', '/marketing/calendar?from=2027-01-01&to=2027-01-31&dateField=publish&q=pag', 'viewer');
      expect(publish.body.cards.map((card) => card.title)).toEqual([pag(12)]);
      expect(publish.body.withoutDateCount).toBe(24);
      const byLabel = await call('get', `/marketing/calendar?from=2026-12-01&to=2026-12-31&labelIds=${ids.labelIg}`, 'viewer');
      expect(byLabel.body.cards).toEqual([]);
    });

    it('filtros inválidos respondem 400 com mensagem', async () => {
      for (const query of ['memberIds=abc', 'labelIds=1,2', 'listIds=x', 'createdFrom=2026-02-31', 'dueFrom=ontem', 'dueFrom=2026-12-10&dueTo=2026-12-01', 'publishFrom=2027-02-01&publishTo=2027-01-01']) {
        const res = await call('get', `/marketing/cards?${query}`, 'viewer');
        expect([query, res.status]).toEqual([query, 400]);
      }
      expect((await call('get', '/marketing/board?dueFrom=2026-12-10&dueTo=2026-12-01', 'viewer')).status).toBe(400);
      expect((await call('get', `/marketing/lists/${paginada.id}/cards?q=${'a'.repeat(151)}`, 'viewer')).status).toBe(400);
    });

    it('mover por vizinhos: depois de, antes de, entre os dois e fim (nenhum vizinho)', async () => {
      const titles = async () => (await call('get', `/marketing/lists/${paginada.id}/cards?limit=100`, 'viewer')).body.data.map((card) => card.title);
      const move = (n: number, body: object) => call('patch', `/marketing/cards/${byTitle[pag(n)]}/move`, 'editor', { listId: paginada.id, ...body });

      expect((await move(25, { afterCardId: byTitle[pag(1)] })).status).toBe(200);
      expect((await titles()).slice(0, 3)).toEqual([pag(1), pag(25), pag(2)]);

      expect((await move(24, { beforeCardId: byTitle[pag(1)] })).status).toBe(200);
      expect((await titles()).slice(0, 3)).toEqual([pag(24), pag(1), pag(25)]);

      expect((await move(23, { afterCardId: byTitle[pag(1)], beforeCardId: byTitle[pag(25)] })).status).toBe(200);
      expect((await titles()).slice(0, 4)).toEqual([pag(24), pag(1), pag(23), pag(25)]);

      expect((await move(24, {})).status).toBe(200);
      const all = await titles();
      expect(all[all.length - 1]).toBe(pag(24));
    });

    it('vizinho que não está na fila de destino (outra fila, o próprio card, inexistente) ou em ordem trocada é 409 e nada muda; position last vai para o fim', async () => {
      const before = await dataSource.query('SELECT id, position FROM marketing_cards WHERE list_id = $1 ORDER BY id', [paginada.id]);
      const other = (await listNamed('Pautas')).cards[0];
      const move = (body: object) => call('patch', `/marketing/cards/${byTitle[pag(5)]}/move`, 'editor', { listId: paginada.id, ...body });

      expect((await move({ afterCardId: other.id })).status).toBe(409);
      expect((await move({ beforeCardId: other.id })).status).toBe(409);
      expect((await move({ afterCardId: byTitle[pag(5)] })).status).toBe(409);
      expect((await move({ afterCardId: '3f0c2b1e-6a52-4f0e-9a43-0f6f4b7a1c11' })).status).toBe(409);
      expect((await move({ afterCardId: byTitle[pag(10)], beforeCardId: byTitle[pag(9)] })).status).toBe(409);
      expect((await move({ afterCardId: 'x' })).status).toBe(400);
      expect((await move({ position: 'meio' })).status).toBe(400);
      expect((await move({ position: 'last', afterCardId: byTitle[pag(10)] })).status).toBe(400);
      expect(await dataSource.query('SELECT id, position FROM marketing_cards WHERE list_id = $1 ORDER BY id', [paginada.id])).toEqual(
        before,
      );
    });

    it('position last manda para o fim da fila de destino, inclusive de outra fila (gera CARD_MOVIDO)', async () => {
      const lista = (await listNamed('Releases')).id;
      const res = await call('patch', `/marketing/cards/${byTitle[pag(7)]}/move`, 'editor', { listId: lista, position: 'last' });

      expect(res.status).toBe(200);
      const cards = (await call('get', `/marketing/lists/${lista}/cards?limit=100`, 'viewer')).body.data;
      expect(cards[cards.length - 1].id).toBe(byTitle[pag(7)]);
      expect((await eventsOf(byTitle[pag(7)])).pop()).toMatchObject({ type: 'CARD_MOVIDO', to_list_name: 'Releases' });
      // volta para a fila paginada para não afetar os demais testes
      await call('patch', `/marketing/cards/${byTitle[pag(7)]}/move`, 'editor', { listId: paginada.id, position: 'last' });
    });

    it('mover para o topo com filtro ativo: vizinho "antes de" visível posiciona logo antes dele', async () => {
      // com filtro de etiqueta só 1..5 aparecem; o primeiro visível é o card 1
      const visible = (await call('get', `/marketing/lists/${paginada.id}/cards?labelIds=${ids.labelIg}`, 'viewer')).body.data;
      const res = await call('patch', `/marketing/cards/${byTitle[pag(20)]}/move`, 'editor', { listId: paginada.id, beforeCardId: visible[0].id });

      expect(res.status).toBe(200);
      const after = (await call('get', `/marketing/lists/${paginada.id}/cards?limit=100`, 'viewer')).body.data.map((card) => card.id);
      expect(after.indexOf(byTitle[pag(20)])).toBe(after.indexOf(visible[0].id) - 1);
    });
  });

  // ---------------------------------------------------------------- versão e conflito

  describe('versão do card e conflito de edição', () => {
    let cardId: string;
    let listA: string;
    let listB: string;
    const detail = async () => (await call('get', `/marketing/cards/${cardId}`, 'viewer')).body;
    const patch = (who: string, body: object) => call('patch', `/marketing/cards/${cardId}`, who, body);

    beforeAll(async () => {
      const lists = (await call('get', '/marketing/lists', 'editor')).body;
      listA = lists[0].id;
      listB = lists[1].id;
      cardId = (await call('post', '/marketing/cards', 'editor', { listId: listA, title: 'Versionado' })).body.id;
    });

    it('nasce na versão 1 e sobe a cada alteração real de campos; no-op, reordenar e itens do card não mudam', async () => {
      expect((await detail()).version).toBe(1);
      expect((await board()).lists.flatMap((l) => l.cards).find((c) => c.id === cardId).version).toBe(1);

      expect((await patch('editor', { title: 'Versionado 2' })).body.version).toBe(2);
      expect((await patch('editor', { title: 'Versionado 2' })).body.version).toBe(2);
      expect((await patch('editor', { dueDate: '2026-12-01', description: 'd' })).body.version).toBe(3);
      expect((await patch('editor', { memberIds: [ids.editor] })).body.version).toBe(4);
      expect((await patch('editor', { labelIds: [ids.labelIg] })).body.version).toBe(5);

      await call('post', `/marketing/cards/${cardId}/comments`, 'editor', { body: 'c' });
      await call('post', `/marketing/cards/${cardId}/tasks`, 'editor', { title: 't' });
      await call('patch', `/marketing/cards/${cardId}/move`, 'editor', { listId: listA, position: 'last' });
      expect((await detail()).version).toBe(5);

      await call('patch', `/marketing/cards/${cardId}/move`, 'editor', { listId: listB, position: 'last' });
      expect((await detail()).version).toBe(6);
      await call('patch', `/marketing/cards/${cardId}/move`, 'editor', { listId: listA, position: 'last' });
      expect((await detail()).version).toBe(7);
    });

    it('campos diferentes desde a baseVersion são mesclados', async () => {
      const base = (await detail()).version;
      await patch('editor', { title: 'Título do editor' });

      const merged = await patch('editor2', { description: 'Descrição do editor2', baseVersion: base });

      expect(merged.status).toBe(200);
      expect(merged.body).toMatchObject({ title: 'Título do editor', description: 'Descrição do editor2', version: base + 2 });
    });

    it('mesmo campo alterado desde a baseVersion: 409 card_conflict com os campos e o card atual; nada é gravado', async () => {
      const base = (await detail()).version;
      await patch('editor', { title: 'Título A', dueDate: '2026-12-09' });
      const before = await detail();

      const res = await patch('editor2', { title: 'Título B', description: 'Outra descrição', dueDate: '2026-12-20', baseVersion: base });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ statusCode: 409, code: 'card_conflict' });
      expect([...res.body.fields].sort()).toEqual(['dueDate', 'title']);
      expect(res.body.current).toMatchObject({ id: cardId, title: 'Título A', dueDate: '2026-12-09', version: before.version });
      const after = await detail();
      expect(after).toMatchObject({ title: 'Título A', description: before.description, version: before.version });
    });

    it('enviar o mesmo valor que já está salvo não é conflito; sem baseVersion vale o último a salvar', async () => {
      const base = (await detail()).version;
      await patch('editor', { title: 'Título C' });

      const same = await patch('editor2', { title: 'Título C', baseVersion: base });
      expect(same.status).toBe(200);
      expect(same.body.version).toBe(base + 1);

      const lww = await patch('editor2', { title: 'Título D' });
      expect(lww.status).toBe(200);
      expect(lww.body.title).toBe('Título D');
    });

    it('membros, etiquetas e fila também colidem', async () => {
      let base = (await detail()).version;
      await patch('editor', { memberIds: [ids.editor, ids.editor2] });
      let res = await patch('editor2', { memberIds: [ids.editor2], baseVersion: base });
      expect([res.status, res.body.code, res.body.fields]).toEqual([409, 'card_conflict', ['members']]);

      base = (await detail()).version;
      await patch('editor', { labelIds: [] });
      res = await patch('editor2', { labelIds: [ids.labelIg], baseVersion: base });
      expect([res.status, res.body.fields]).toEqual([409, ['labels']]);

      base = (await detail()).version;
      await call('patch', `/marketing/cards/${cardId}/move`, 'editor', { listId: listB, position: 'last' });
      res = await patch('editor2', { listId: listA, baseVersion: base });
      expect([res.status, res.body.fields]).toEqual([409, ['list']]);
      // mover para a fila onde o card já está não é conflito
      expect((await patch('editor2', { listId: listB, baseVersion: base })).status).toBe(200);
    });

    it('excluir uma etiqueta na Configuração sobe a versão dos cards afetados e conflita com quem editava as etiquetas', async () => {
      const label = (await call('post', '/marketing/labels', 'admina', { name: 'Efêmera', color: '#222' })).body;
      await patch('editor', { labelIds: [label.id] });
      const base = (await detail()).version;

      await call('delete', `/marketing/labels/${label.id}`, 'admina');

      expect((await detail()).version).toBe(base + 1);
      const res = await patch('editor2', { labelIds: [ids.labelIg], baseVersion: base });
      expect([res.status, res.body.fields]).toEqual([409, ['labels']]);
    });

    it('baseVersion maior que a versão atual é 400 e nada é gravado', async () => {
      const current = (await detail()).version;

      const res = await patch('editor', { title: 'Futuro', baseVersion: current + 1 });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Versão do card inválida. Atualize o card.');
      expect((await detail()).version).toBe(current);
      expect((await patch('editor', { description: 'ok', baseVersion: current })).status).toBe(200);
    });

    it('card arquivado: 409 card_archived em qualquer alteração; baseVersion inválida é 400', async () => {
      expect((await patch('editor', { title: 'x', baseVersion: 0 })).status).toBe(400);
      expect((await patch('editor', { title: 'x', baseVersion: 'a' })).status).toBe(400);

      await call('post', `/marketing/cards/${cardId}/archive`, 'editor');
      const edit = await patch('editor', { title: 'Arquivado', baseVersion: 1 });
      expect(edit.status).toBe(409);
      expect(edit.body).toMatchObject({ statusCode: 409, code: 'card_archived' });
      expect((await call('post', `/marketing/cards/${cardId}/comments`, 'editor', { body: 'x' })).body.code).toBe('card_archived');
      await call('post', `/marketing/cards/${cardId}/restore`, 'admina');
    });
  });

  // ---------------------------------------------------------------- histórico

  describe('histórico (C9)', () => {
    it('lista o histórico do card, mais recente primeiro, paginado; outra organização recebe 404', async () => {
      const res = await call('get', `/marketing/cards/${ids.cardInPautas}/history?limit=2`, 'viewer');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ limit: 2, page: 1 });
      expect(res.body.total).toBeGreaterThanOrEqual(2);
      expect(res.body.data).toHaveLength(2);
      const dates = res.body.data.map((e) => new Date(e.createdAt).getTime());
      expect(dates[0]).toBeGreaterThanOrEqual(dates[1]);
      expect(res.body.data[0]).toMatchObject({ cardId: ids.cardInPautas, userName: expect.any(String), description: expect.any(String) });
      expect((await call('get', `/marketing/cards/${ids.cardInPautas}/history`, 'adminb')).status).toBe(404);
    });

    it('BUG-07: as descrições das etiquetas têm gramática correta', async () => {
      const cardId = (await call('post', '/marketing/cards', 'editor', { listId: (await listNamed('Releases')).id, title: 'Gramática' })).body.id;
      await call('patch', `/marketing/cards/${cardId}`, 'editor', { labelIds: [ids.labelIg] });
      await call('patch', `/marketing/cards/${cardId}`, 'editor', { labelIds: [] });

      const descriptions = (await dataSource.query('SELECT description FROM marketing_history_events WHERE card_id = $1 ORDER BY created_at, id', [cardId])).map((row) => row.description);
      expect(descriptions).toEqual(['Card "Gramática" criado na fila Releases.', 'Etiqueta Instagram adicionada ao card.', 'Etiqueta Instagram removida do card.']);
    });

    it('BUG-06: page e offset gigantes são 400 com mensagem clara (nunca 500)', async () => {
      const huge = '9223372036854775807';
      const lista = (await call('get', '/marketing/lists', 'viewer')).body[0].id;
      const responses = await Promise.all([
        call('get', `/marketing/cards?page=${huge}`, 'viewer'),
        call('get', `/marketing/cards/archived?page=${huge}`, 'viewer'),
        call('get', `/marketing/cards/${ids.cardInPautas}/history?page=${huge}`, 'viewer'),
        call('get', `/marketing/cards/${ids.cardInPautas}/comments?page=${huge}`, 'viewer'),
        call('get', `/marketing/lists/${lista}/cards?offset=${huge}`, 'viewer'),
      ]);
      expect(responses.map((res) => res.status)).toEqual([400, 400, 400, 400, 400]);
      expect(responses[0].body.message).toEqual(['page deve ser no máximo 100000.']);
      expect(responses[4].body.message).toEqual(['offset deve ser no máximo 1000000.']);
      expect((await call('get', '/marketing/cards?page=100000', 'viewer')).status).toBe(200);
    });

    it('o histórico guarda o nome do usuário e da fila como snapshot', async () => {
      const events = await eventsOf(ids.cardInPautas);
      expect(events[0]).toMatchObject({ type: 'CARD_CRIADO', to_list_name: 'Pautas', user_name: 'Pessoa editor' });
    });
  });
});
