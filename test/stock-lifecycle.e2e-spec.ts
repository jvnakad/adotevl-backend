import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { TestAppModule, cleanupAccess, cleanupStock, joinTeam } from './test-app.module';
import { Profile } from '../src/profile/profile.entity';
import { Organization } from '../src/organization/organization.entity';
import { User } from '../src/user/user.entity';
import { AccessLevel, Screen } from '../src/access/access';

describe('Estoque (e2e)', () => {
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

  const CNPJ_A = '91919191919191';
  const CNPJ_B = '92929292929292';

  async function cleanOrg(cnpj: string) {
    const existing = await orgRepo.findOne({ where: { cnpj } });
    if (!existing) return;
    await cleanupStock(app, existing.id);
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
      email: `${key}.estoque@teste.com`,
      password: await bcrypt.hash('senha123', 10),
      profileId: profile.id,
      organizationId,
      isConfirmed: true,
      isApproved: true,
      isActive: true,
    });
    await joinTeam(app, user, access);
    ids[key] = user.id;
    tokens[key] = await login(`${key}.estoque@teste.com`);
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [TestAppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    dataSource = app.get(DataSource);
    orgRepo = moduleFixture.get(getRepositoryToken(Organization));
    userRepo = moduleFixture.get(getRepositoryToken(User));
    const profileRepo: Repository<Profile> = moduleFixture.get(getRepositoryToken(Profile));

    await cleanOrg(CNPJ_A);
    await cleanOrg(CNPJ_B);
    if (!(await profileRepo.findOne({ where: { name: 'VOLUNTEER' } }))) {
      await profileRepo.save([{ name: 'ADMIN' }, { name: 'FINANCIAL' }, { name: 'VOLUNTEER' }]);
    }
    orgA = (await orgRepo.save({ legalName: 'Org Estoque A', cnpj: CNPJ_A })).id;
    orgB = (await orgRepo.save({ legalName: 'Org Estoque B', cnpj: CNPJ_B })).id;

    await createUser(orgA, 'admina', '71000000001', 'ADMIN');
    await createUser(orgA, 'viewer', '71000000002', { [Screen.STOCK]: AccessLevel.VIEW });
    await createUser(orgA, 'typesview', '71000000003', { [Screen.STOCK]: AccessLevel.VIEW, [Screen.STOCK_PRODUCT_TYPES]: AccessLevel.VIEW });
    await createUser(orgA, 'historyview', '71000000004', { [Screen.STOCK]: AccessLevel.VIEW, [Screen.STOCK_HISTORY]: AccessLevel.VIEW });
    await createUser(orgA, 'other', '71000000005', { [Screen.PETS]: AccessLevel.EDIT });
    await createUser(orgB, 'adminb', '71000000006', 'ADMIN');
  }, 60000);

  afterAll(async () => {
    for (const orgId of [orgA, orgB]) {
      await cleanupStock(app, orgId);
      await cleanupAccess(app, orgId);
      await userRepo.delete({ organizationId: orgId });
      await orgRepo.delete({ id: orgId });
    }
    await app.close();
  }, 60000);

  const eventsOf = async (organizationId: string) =>
    dataSource.query('SELECT type, subject_name, previous_subject_name, description, metadata, user_id, user_name FROM stock_history_events WHERE organization_id = $1 ORDER BY created_at, id', [organizationId]);
  const countEvents = async (organizationId: string) => (await eventsOf(organizationId)).length;

  // ---------------------------------------------------------------- permissões

  describe('permissões', () => {
    it('sem token: 401', async () => {
      expect((await request(server()).get('/stock/products')).status).toBe(401);
    });

    it('usuário sem acesso a Estoque recebe 403 em todas as rotas e nada é lido nem gravado', async () => {
      const someId = '3f0c2b1e-6a52-4f0e-9a43-0f6f4b7a1c11';
      const results = await Promise.all([
        call('get', '/stock/products', 'other'),
        call('get', `/stock/products/${someId}`, 'other'),
        call('post', '/stock/products', 'other', {}),
        call('patch', `/stock/products/${someId}`, 'other', {}),
        call('delete', `/stock/products/${someId}`, 'other'),
        call('get', '/stock/product-types', 'other'),
        call('get', '/stock/product-types/options', 'other'),
        call('get', `/stock/product-types/${someId}/usage`, 'other'),
        call('post', '/stock/product-types', 'other', { name: 'X' }),
        call('patch', `/stock/product-types/${someId}`, 'other', { name: 'X' }),
        call('delete', `/stock/product-types/${someId}`, 'other'),
        call('get', '/stock/history', 'other'),
        call('get', '/stock/history/users', 'other'),
      ]);
      expect(results.map((r) => r.status)).toEqual(Array(13).fill(403));
      expect(await dataSource.query('SELECT count(*)::int AS n FROM product_types WHERE organization_id = $1', [orgA])).toEqual([{ n: 0 }]);
    });

    it('Visualizar em Estoque lista produtos e opções de tipos, mas não escreve nem vê tipos completos nem histórico', async () => {
      expect((await call('get', '/stock/products', 'viewer')).status).toBe(200);
      expect((await call('get', '/stock/product-types/options', 'viewer')).status).toBe(200);
      const denied = await Promise.all([
        call('post', '/stock/products', 'viewer', { name: 'X', productTypeId: '3f0c2b1e-6a52-4f0e-9a43-0f6f4b7a1c11', unit: 'UNIT', quantity: 1 }),
        call('get', '/stock/product-types', 'viewer'),
        call('post', '/stock/product-types', 'viewer', { name: 'X' }),
        call('get', '/stock/history', 'viewer'),
        call('get', '/stock/history/users', 'viewer'),
      ]);
      expect(denied.map((r) => r.status)).toEqual([403, 403, 403, 403, 403]);
      expect((await call('post', '/stock/products', 'viewer', {})).body.message).toBe('Sua equipe só pode visualizar Estoque.');
    });

    it('Visualizar em Tipos lista e conta, mas não cria; Visualizar em Histórico lê o histórico', async () => {
      expect((await call('get', '/stock/product-types', 'typesview')).status).toBe(200);
      expect((await call('post', '/stock/product-types', 'typesview', { name: 'X' })).status).toBe(403);
      expect((await call('get', '/stock/history', 'historyview')).status).toBe(200);
      expect((await call('get', '/stock/history/users', 'historyview')).status).toBe(200);
      expect((await call('get', '/stock/product-types', 'historyview')).status).toBe(403);
    });

    it('não existe rota de escrita para o histórico', async () => {
      expect([404, 405]).toContain((await call('post', '/stock/history', 'admina', {})).status);
      expect([404, 405]).toContain((await call('delete', '/stock/history', 'admina')).status);
    });

    it('mudança de equipe vale na requisição seguinte', async () => {
      const teamId = (await dataSource.query('SELECT team_id FROM volunteers WHERE user_id = $1', [ids.viewer]))[0].team_id;
      await dataSource.query(`INSERT INTO team_permissions (team_id, screen, level) VALUES ($1, 'STOCK_PRODUCT_TYPES', 'VIEW') ON CONFLICT DO NOTHING`, [teamId]);
      expect((await call('get', '/stock/product-types', 'viewer')).status).toBe(200);
      await dataSource.query(`DELETE FROM team_permissions WHERE team_id = $1 AND screen = 'STOCK_PRODUCT_TYPES'`, [teamId]);
      expect((await call('get', '/stock/product-types', 'viewer')).status).toBe(403);
    });

    it('/auth/me da equipe Admin traz as telas do estoque', async () => {
      const me = await call('get', '/auth/me', 'admina');
      expect(me.body.access.permissions).toMatchObject({ STOCK: 'EDIT', STOCK_PRODUCT_TYPES: 'EDIT', STOCK_HISTORY: 'VIEW' });
    });
  });

  // ---------------------------------------------------------------- tipos

  describe('tipos de produto', () => {
    it('começa vazio (sem seed)', async () => {
      const list = await call('get', '/stock/product-types', 'admina');
      expect(list.body).toMatchObject({ data: [], total: 0, page: 1, limit: 10, totalPages: 0 });
      expect((await call('get', '/stock/product-types/options', 'admina')).body).toEqual([]);
    });

    it('cria normalizando espaços, grava created_by e o evento TIPO_CRIADO com o nome do usuário', async () => {
      const res = await call('post', '/stock/product-types', 'admina', { name: '  Produto   de  limpeza  ' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ name: 'Produto de limpeza', createdBy: ids.admina, updatedBy: null });
      expect(res.body).not.toHaveProperty('organizationId');
      ids.limpeza = res.body.id;

      const events = await eventsOf(orgA);
      expect(events[0]).toMatchObject({ type: 'TIPO_CRIADO', subject_name: 'Produto de limpeza', description: 'Tipo de produto Produto de limpeza criado.', user_id: ids.admina, user_name: 'Pessoa admina' });
    });

    it('valida o nome: vazio, só espaços, ausente e acima de 250', async () => {
      for (const body of [{}, { name: '' }, { name: '   ' }]) {
        const res = await call('post', '/stock/product-types', 'admina', body);
        expect(res.status).toBe(400);
        expect(res.body.message).toContain('Informe o nome do tipo.');
      }
      const long = await call('post', '/stock/product-types', 'admina', { name: 'a'.repeat(251) });
      expect(long.status).toBe(400);
      expect(long.body.message).toContain('O nome pode ter até 250 caracteres.');
      // 250 é aceito (e espaços extras não contam)
      expect((await call('post', '/stock/product-types', 'admina', { name: `  ${'z'.repeat(250)}  ` })).status).toBe(201);
    });

    it('nome duplicado entre ativos é 409 (ignora acento, maiúscula e espaços); pontuação diferencia; outra organização aceita', async () => {
      expect((await call('post', '/stock/product-types', 'admina', { name: 'Ração' })).status).toBe(201);
      for (const name of ['racao', 'RAÇÃO', ' Racão ']) {
        const res = await call('post', '/stock/product-types', 'admina', { name });
        expect(res.status).toBe(409);
        expect(res.body.message).toBe('Já existe um tipo de produto com esse nome.');
      }
      expect((await call('post', '/stock/product-types', 'admina', { name: 'Pão de Açúcar' })).status).toBe(201);
      expect((await call('post', '/stock/product-types', 'admina', { name: 'Pão-de-Açúcar' })).status).toBe(201);
      expect((await call('post', '/stock/product-types', 'admina', { name: 'pao de  acucar' })).status).toBe(409);
      expect((await call('post', '/stock/product-types', 'adminb', { name: 'Ração' })).status).toBe(201);
    });

    it('cadastros simultâneos com o mesmo nome: só um é aceito (índice único parcial)', async () => {
      const results = await Promise.all(Array.from({ length: 4 }, () => call('post', '/stock/product-types', 'admina', { name: 'Simultâneo' })));
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409, 409, 409]);
      const active = await dataSource.query(`SELECT count(*)::int AS n FROM product_types WHERE organization_id = $1 AND name_normalized = 'simultaneo' AND is_active`, [orgA]);
      expect(active[0].n).toBe(1);
    });

    it('lista em ordem alfabética ignorando acento e maiúscula, paginada, e as opções na mesma ordem', async () => {
      for (const name of ['medicamento', 'Água sanitária', 'Higiene']) await call('post', '/stock/product-types', 'admina', { name });
      const list = await call('get', '/stock/product-types?limit=100', 'typesview');
      const names = list.body.data.map((t: any) => t.name);
      // Ordem determinística por código de caractere do nome normalizado (COLLATE "C"), com pontuação e dígitos
      const normalized = (name: string) => name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
      expect(names).toEqual([...names].sort((a, b) => (normalized(a) < normalized(b) ? -1 : normalized(a) > normalized(b) ? 1 : 0)));
      expect(names.indexOf('Pão de Açúcar')).toBeLessThan(names.indexOf('Pão-de-Açúcar')); // espaço (0x20) antes de hífen (0x2d)
      expect(names.indexOf('Água sanitária')).toBeLessThan(names.indexOf('Higiene'));
      expect(names.indexOf('Higiene')).toBeLessThan(names.indexOf('medicamento'));
      expect(names.indexOf('medicamento')).toBeLessThan(names.indexOf('Ração'));
      ids.racao = list.body.data.find((t: any) => t.name === 'Ração').id;
      ids.medicamento = list.body.data.find((t: any) => t.name === 'medicamento').id;
      ids.higiene = list.body.data.find((t: any) => t.name === 'Higiene').id;

      const page = await call('get', '/stock/product-types?limit=2&page=2', 'admina');
      expect(page.body).toMatchObject({ page: 2, limit: 2, total: list.body.total });
      expect(page.body.data.map((t: any) => t.name)).toEqual(names.slice(2, 4));

      const options = await call('get', '/stock/product-types/options', 'viewer');
      expect(options.body.map((t: any) => t.name)).toEqual(names);
      expect(Object.keys(options.body[0]).sort()).toEqual(['id', 'name']);
    });

    it('ordem A→Z determinística com dígitos e pontuação, igual na lista, nas opções e entre páginas', async () => {
      const extra = ['Item 10', 'Item 2', 'Item-1', 'a1', 'ab', 'A_b', 'Ábaco'];
      for (const name of extra) expect((await call('post', '/stock/product-types', 'admina', { name })).status).toBe(201);
      const list = (await call('get', '/stock/product-types?limit=100', 'admina')).body.data.map((t: any) => t.name);
      const picked = list.filter((name: string) => extra.includes(name));
      expect(picked).toEqual([...picked].sort((a, b) => {
        const n = (v: string) => v.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
        return n(a) < n(b) ? -1 : n(a) > n(b) ? 1 : 0;
      }));
      expect(picked).toEqual(['a1', 'A_b', 'ab', 'Ábaco', 'Item 10', 'Item 2', 'Item-1']);
      const options = (await call('get', '/stock/product-types/options', 'viewer')).body.map((t: any) => t.name);
      expect(options).toEqual(list);
      const pages: string[] = [];
      for (let page = 1; page <= Math.ceil(list.length / 4); page++) {
        pages.push(...(await call('get', `/stock/product-types?limit=4&page=${page}`, 'admina')).body.data.map((t: any) => t.name));
      }
      expect(pages).toEqual(list);
      for (const t of (await call('get', '/stock/product-types?limit=100', 'admina')).body.data) {
        if (extra.includes(t.name)) await call('delete', `/stock/product-types/${t.id}`, 'admina');
      }
    });

    it('isola por organização: a lista da B só tem os tipos da B', async () => {
      const list = await call('get', '/stock/product-types', 'adminb');
      expect(list.body.data.map((t: any) => t.name)).toEqual(['Ração']);
    });

    it('renomear só por acento conta, grava updated_by e gera TIPO_RENOMEADO', async () => {
      const before = await countEvents(orgA);
      const res = await call('patch', `/stock/product-types/${ids.racao}`, 'admina', { name: 'RAÇÃO' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ name: 'RAÇÃO', updatedBy: ids.admina });
      const events = await eventsOf(orgA);
      expect(events.length).toBe(before + 1);
      expect(events[events.length - 1]).toMatchObject({ type: 'TIPO_RENOMEADO', subject_name: 'RAÇÃO', previous_subject_name: 'Ração', description: 'Tipo de produto renomeado: Ração → RAÇÃO.', metadata: { before: 'Ração', after: 'RAÇÃO' } });
      await call('patch', `/stock/product-types/${ids.racao}`, 'admina', { name: 'Ração' });
    });

    it('salvar o mesmo nome (só espaços diferentes) não altera nada nem gera evento', async () => {
      const before = await countEvents(orgA);
      const res = await call('patch', `/stock/product-types/${ids.racao}`, 'admina', { name: '  Ração ' });
      expect(res.status).toBe(200);
      expect(await countEvents(orgA)).toBe(before);
    });

    it('renomear para o nome de outro tipo ativo é 409', async () => {
      const res = await call('patch', `/stock/product-types/${ids.medicamento}`, 'admina', { name: 'ração' });
      expect(res.status).toBe(409);
      expect(res.body.message).toBe('Já existe um tipo de produto com esse nome.');
    });

    it('tipo de outra organização é 404 para consultar contagem, renomear e excluir', async () => {
      const orgBTypeId = (await call('get', '/stock/product-types', 'adminb')).body.data[0].id;
      expect((await call('get', `/stock/product-types/${orgBTypeId}/usage`, 'admina')).status).toBe(404);
      expect((await call('patch', `/stock/product-types/${orgBTypeId}`, 'admina', { name: 'Hack' })).status).toBe(404);
      expect((await call('delete', `/stock/product-types/${orgBTypeId}`, 'admina')).status).toBe(404);
      expect((await call('get', '/stock/product-types', 'adminb')).body.data[0].name).toBe('Ração');
    });

    it('id que não é UUID é 400', async () => {
      expect((await call('patch', '/stock/product-types/abc', 'admina', { name: 'X' })).status).toBe(400);
    });
  });

  // ---------------------------------------------------------------- produtos

  describe('produtos', () => {
    const newProduct = (overrides: object = {}) => ({ name: 'Ração Premium', productTypeId: ids.racao, unit: 'KG', quantity: '10', ...overrides });

    it('cria: quantidade como string de 3 casas, snapshot do criador, isExpired false e evento PRODUTO_CRIADO', async () => {
      const res = await call('post', '/stock/products', 'admina', newProduct({ expirationDate: '2099-12-31', notes: '  Saco de 15 kg ' }));
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        name: 'Ração Premium',
        productTypeId: ids.racao,
        productType: { id: ids.racao, name: 'Ração', isActive: true },
        unit: 'KG',
        quantity: '10.000',
        expirationDate: '2099-12-31',
        isExpired: false,
        notes: 'Saco de 15 kg',
        createdBy: ids.admina,
        createdByName: 'Pessoa admina',
        updatedBy: null,
        updatedByName: null,
      });
      expect(res.body).not.toHaveProperty('organizationId');
      ids.premium = res.body.id;

      const events = await eventsOf(orgA);
      expect(events[events.length - 1]).toMatchObject({ type: 'PRODUTO_CRIADO', subject_name: 'Ração Premium', description: 'Produto Ração Premium criado com 10,000 kg.', user_name: 'Pessoa admina' });
      expect(events[events.length - 1].metadata.values).toMatchObject({ productTypeName: 'Ração', quantity: '10.000', expirationDate: '2099-12-31' });
    });

    it('exige nome, tipo, unidade e quantidade, cada um com a sua mensagem', async () => {
      const res = await call('post', '/stock/products', 'admina', {});
      expect(res.status).toBe(400);
      expect(res.body.message).toEqual(expect.arrayContaining(['Informe o nome do produto.', 'Escolha o tipo de produto.', 'Escolha a unidade de medida.', 'Informe a quantidade.']));
    });

    it.each([
      [{ unit: 'UNIT', quantity: '2.5' }, 'Quantidade em unidade deve ser um número inteiro.'],
      [{ quantity: '-1' }, 'A quantidade não pode ser negativa.'],
      [{ quantity: '1.2345' }, 'A quantidade pode ter no máximo 3 casas decimais.'],
      [{ quantity: '1000000000' }, 'A quantidade máxima é 999999999,999.'],
      [{ quantity: '1,5' }, 'Quantidade inválida. Use apenas números, com ponto como separador decimal.'],
      [{ quantity: 'abc' }, 'Quantidade inválida. Use apenas números, com ponto como separador decimal.'],
    ])('recusa quantidade %j sem arredondar e sem gravar', async (overrides, message) => {
      const before = await dataSource.query('SELECT count(*)::int AS n FROM products WHERE organization_id = $1', [orgA]);
      const res = await call('post', '/stock/products', 'admina', newProduct({ name: 'Inválido', ...overrides }));
      expect(res.status).toBe(400);
      expect(res.body.message).toBe(message);
      expect(await dataSource.query('SELECT count(*)::int AS n FROM products WHERE organization_id = $1', [orgA])).toEqual(before);
    });

    it('aceita quantidade 0 em qualquer unidade e o máximo do numeric(12,3)', async () => {
      expect((await call('post', '/stock/products', 'admina', newProduct({ name: 'Zero un', unit: 'UNIT', quantity: 0 }))).body.quantity).toBe('0.000');
      expect((await call('post', '/stock/products', 'admina', newProduct({ name: 'Zero litro', unit: 'LITER', quantity: '0' }))).body.quantity).toBe('0.000');
      const max = await call('post', '/stock/products', 'admina', newProduct({ name: 'Máximo', quantity: '999999999.999' }));
      expect(max.status).toBe(201);
      expect(max.body.quantity).toBe('999999999.999');
    });

    it('valida vencimento (data real) e tamanho de observações', async () => {
      expect((await call('post', '/stock/products', 'admina', newProduct({ name: 'Data ruim', expirationDate: '2026-02-31' }))).body.message).toContain('Informe uma data válida.');
      expect((await call('post', '/stock/products', 'admina', newProduct({ name: 'Notas', notes: 'a'.repeat(1001) }))).body.message).toContain('As observações podem ter até 1.000 caracteres.');
    });

    it('nome duplicado entre ativos é 409; outra organização aceita', async () => {
      for (const name of ['racao  premium', 'RAÇÃO PREMIUM']) {
        const res = await call('post', '/stock/products', 'admina', newProduct({ name }));
        expect(res.status).toBe(409);
        expect(res.body.message).toBe('Já existe um produto com esse nome.');
      }
      const typeB = (await call('get', '/stock/product-types', 'adminb')).body.data[0].id;
      expect((await call('post', '/stock/products', 'adminb', { name: 'Ração Premium', productTypeId: typeB, unit: 'KG', quantity: 1 })).status).toBe(201);
    });

    it('cadastros simultâneos do mesmo produto: só um é aceito', async () => {
      const results = await Promise.all(Array.from({ length: 4 }, () => call('post', '/stock/products', 'admina', newProduct({ name: 'Corrida', quantity: 1 }))));
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
    });

    it('tipo de outra organização, inexistente ou excluído é 400', async () => {
      const typeB = (await call('get', '/stock/product-types', 'adminb')).body.data[0].id;
      const other = await call('post', '/stock/products', 'admina', newProduct({ name: 'Tipo de B', productTypeId: typeB }));
      expect(other.status).toBe(400);
      expect(other.body.message).toBe('Tipo de produto não encontrado.');
      expect((await call('post', '/stock/products', 'admina', newProduct({ name: 'Sem tipo', productTypeId: '3f0c2b1e-6a52-4f0e-9a43-0f6f4b7a1c11' }))).status).toBe(400);
    });

    it('detalhe: 200 na própria organização e 404 em outra', async () => {
      const own = await call('get', `/stock/products/${ids.premium}`, 'viewer');
      expect(own.status).toBe(200);
      expect(own.body.id).toBe(ids.premium);
      const cross = await call('get', `/stock/products/${ids.premium}`, 'adminb');
      expect(cross.status).toBe(404);
      expect((await call('patch', `/stock/products/${ids.premium}`, 'adminb', { quantity: 1 })).status).toBe(404);
      expect((await call('delete', `/stock/products/${ids.premium}`, 'adminb')).status).toBe(404);
      expect((await call('get', `/stock/products/${ids.premium}`, 'admina')).body.quantity).toBe('10.000');
    });

    it('edita só a quantidade: grava updated_by, um item no de/para e descrição sem valores', async () => {
      await dataSource.query('UPDATE products SET unit = $2::products_unit_enum, quantity = $3 WHERE id = $1', [ids.premium, 'UNIT', 10]);
      const before = await countEvents(orgA);
      const res = await call('patch', `/stock/products/${ids.premium}`, 'admina', { quantity: 8 });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ quantity: '8.000', unit: 'UNIT', updatedBy: ids.admina, updatedByName: 'Pessoa admina' });
      const events = await eventsOf(orgA);
      expect(events.length).toBe(before + 1);
      const event = events[events.length - 1];
      expect(event).toMatchObject({ type: 'PRODUTO_EDITADO', description: 'Produto Ração Premium editado.', previous_subject_name: null });
      expect(event.metadata.fields).toEqual([{ field: 'quantity', label: 'Quantidade', before: '10.000', after: '8.000', beforeUnit: 'UNIT', afterUnit: 'UNIT' }]);
    });

    it('edição sem mudança real: nada muda (updatedAt incluso) e nenhum evento', async () => {
      const before = await call('get', `/stock/products/${ids.premium}`, 'admina');
      const eventsBefore = await countEvents(orgA);
      const res = await call('patch', `/stock/products/${ids.premium}`, 'admina', { name: 'Ração Premium', quantity: '8', unit: 'UNIT', notes: 'Saco de 15 kg' });
      expect(res.status).toBe(200);
      expect(res.body.updatedAt).toBe(before.body.updatedAt);
      expect(await countEvents(orgA)).toBe(eventsBefore);
      expect((await call('patch', `/stock/products/${ids.premium}`, 'admina', {})).status).toBe(200);
      expect(await countEvents(orgA)).toBe(eventsBefore);
    });

    it('trocar a unidade sem quantidade zera; com quantidade grava a enviada; decimal em UNIT é 400', async () => {
      const zero = await call('patch', `/stock/products/${ids.premium}`, 'admina', { unit: 'KG' });
      expect(zero.body).toMatchObject({ unit: 'KG', quantity: '0.000' });
      const event = (await eventsOf(orgA)).pop();
      expect(event.metadata.fields).toEqual([
        { field: 'unit', label: 'Unidade de medida', before: 'UNIT', after: 'KG' },
        { field: 'quantity', label: 'Quantidade', before: '8.000', after: '0.000', beforeUnit: 'UNIT', afterUnit: 'KG' },
      ]);

      const withQty = await call('patch', `/stock/products/${ids.premium}`, 'admina', { unit: 'LITER', quantity: '2.5' });
      expect(withQty.body).toMatchObject({ unit: 'LITER', quantity: '2.500' });

      const bad = await call('patch', `/stock/products/${ids.premium}`, 'admina', { unit: 'UNIT', quantity: '2.5' });
      expect(bad.status).toBe(400);
      expect((await call('get', `/stock/products/${ids.premium}`, 'admina')).body).toMatchObject({ unit: 'LITER', quantity: '2.500' });
    });

    it('renomear confere duplicidade e guarda o nome anterior no evento; tipo trocado registra nomes dos dois lados', async () => {
      const dup = await call('patch', `/stock/products/${ids.premium}`, 'admina', { name: 'Zero un' });
      expect(dup.status).toBe(409);

      const res = await call('patch', `/stock/products/${ids.premium}`, 'admina', { name: 'Ração Super', productTypeId: ids.medicamento });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ name: 'Ração Super', productType: { id: ids.medicamento, name: 'medicamento', isActive: true } });
      const event = (await eventsOf(orgA)).pop();
      expect(event).toMatchObject({ subject_name: 'Ração Super', previous_subject_name: 'Ração Premium' });
      expect(event.metadata.fields).toEqual([
        { field: 'name', label: 'Nome', before: 'Ração Premium', after: 'Ração Super' },
        { field: 'productTypeId', label: 'Tipo de produto', before: ids.racao, after: ids.medicamento, beforeName: 'Ração', afterName: 'medicamento' },
      ]);
      // volta ao estado original para os próximos testes
      await call('patch', `/stock/products/${ids.premium}`, 'admina', { name: 'Ração Premium', productTypeId: ids.racao });
    });

    it('limpa vencimento e observações com null', async () => {
      const res = await call('patch', `/stock/products/${ids.premium}`, 'admina', { expirationDate: null, notes: null });
      expect(res.body).toMatchObject({ expirationDate: null, notes: null, isExpired: false });
    });

    it('selo Vencido: ontem é vencido; hoje, futuro e sem vencimento não (dia de Brasília)', async () => {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
      const shift = (days: number) => new Date(new Date(`${today}T12:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);
      const make = async (name: string, expirationDate: string | null) => (await call('post', '/stock/products', 'admina', newProduct({ name, unit: 'UNIT', quantity: 1, expirationDate }))).body;
      expect((await make('Venc ontem', shift(-1))).isExpired).toBe(true);
      expect((await make('Venc hoje', today)).isExpired).toBe(false);
      expect((await make('Venc amanhã', shift(1))).isExpired).toBe(false);
      expect((await make('Sem venc', null)).isExpired).toBe(false);
      const list = await call('get', '/stock/products?limit=100&search=venc', 'viewer');
      expect(Object.fromEntries(list.body.data.map((p: any) => [p.name, p.isExpired]))).toMatchObject({ 'Venc ontem': true, 'Venc hoje': false, 'Venc amanhã': false, 'Sem venc': false });
    });

    describe('listagem e filtros', () => {
      beforeAll(async () => {
        // Datas de cadastro controladas (instantes UTC; o dia local é o de Brasília)
        const set = (name: string, at: string) => dataSource.query('UPDATE products SET created_at = $3 WHERE organization_id = $1 AND name = $2', [orgA, name, at]);
        await set('Zero un', '2026-10-01T15:00:00Z'); // 01/10 12h
        await set('Zero litro', '2026-10-11T02:30:00Z'); // 10/10 23:30 em Brasília
        await set('Máximo', '2026-10-15T15:00:00Z'); // 15/10
      });

      it('ordena do mais recente para o mais antigo e pagina com total correto', async () => {
        const page1 = await call('get', '/stock/products?limit=3', 'viewer');
        expect(page1.status).toBe(200);
        expect(page1.body).toMatchObject({ page: 1, limit: 3 });
        expect(page1.body.data).toHaveLength(3);
        const all = await call('get', '/stock/products?limit=100', 'viewer');
        const dates = all.body.data.map((p: any) => new Date(p.createdAt).getTime());
        expect([...dates].sort((a, b) => b - a)).toEqual(dates);
        expect(page1.body.total).toBe(all.body.total);
        expect(page1.body.totalPages).toBe(Math.ceil(all.body.total / 3));
        expect(page1.body.data.map((p: any) => p.id)).toEqual(all.body.data.slice(0, 3).map((p: any) => p.id));
      });

      it('busca por nome ignora acento e maiúscula e é parcial', async () => {
        const names = async (search: string) => (await call('get', `/stock/products?search=${encodeURIComponent(search)}`, 'viewer')).body.data.map((p: any) => p.name);
        expect(await names('racao')).toContain('Ração Premium');
        expect(await names('PREMIUM')).toContain('Ração Premium');
        expect(await names('ração p')).toContain('Ração Premium');
        expect(await names('areia')).toEqual([]);
        expect(await names('%')).toEqual([]); // curinga do LIKE é literal
      });

      it('filtra por tipo', async () => {
        const res = await call('get', `/stock/products?productTypeId=${ids.racao}&limit=100`, 'viewer');
        expect(res.body.data.length).toBeGreaterThan(0);
        expect(res.body.data.every((p: any) => p.productTypeId === ids.racao)).toBe(true);
        const none = await call('get', `/stock/products?productTypeId=${ids.higiene}`, 'viewer');
        expect(none.body.data).toEqual([]);
        expect((await call('get', '/stock/products?productTypeId=abc', 'viewer')).status).toBe(400);
      });

      it('período por dia local de Brasília, inclusivo; o cadastro de 23:30 conta no dia 10', async () => {
        const names = async (qs: string) => (await call('get', `/stock/products?limit=100&${qs}`, 'viewer')).body.data.map((p: any) => p.name);
        const between = await names('from=2026-10-10&to=2026-10-15');
        expect(between).toEqual(expect.arrayContaining(['Zero litro', 'Máximo']));
        expect(between).not.toContain('Zero un');
        expect(await names('from=2026-10-10&to=2026-10-10')).toEqual(['Zero litro']);
        expect(await names('from=2026-10-11&to=2026-10-14')).not.toContain('Zero litro');
        const onlyTo = await names('to=2026-10-10');
        expect(onlyTo).toEqual(expect.arrayContaining(['Zero un', 'Zero litro']));
        expect(onlyTo).not.toContain('Máximo');
      });

      it('período invertido ou data inválida é 400', async () => {
        const inverted = await call('get', '/stock/products?from=2026-10-15&to=2026-10-10', 'viewer');
        expect(inverted.status).toBe(400);
        expect(inverted.body.message).toBe('A data inicial não pode ser maior que a final.');
        expect((await call('get', '/stock/products?from=2026-02-31', 'viewer')).status).toBe(400);
        expect((await call('get', '/stock/products?to=15/10/2026', 'viewer')).status).toBe(400);
      });

      it('filtros combinam com E', async () => {
        const res = await call('get', `/stock/products?productTypeId=${ids.racao}&search=maximo&from=2026-10-15&to=2026-10-15`, 'viewer');
        expect(res.body.data.map((p: any) => p.name)).toEqual(['Máximo']);
        const empty = await call('get', `/stock/products?productTypeId=${ids.racao}&search=maximo&from=2026-10-16`, 'viewer');
        expect(empty.body.data).toEqual([]);
      });

      it('não lista produto de outra organização', async () => {
        const res = await call('get', '/stock/products?limit=100', 'adminb');
        expect(res.body.data.map((p: any) => p.name)).toEqual(['Ração Premium']);
        expect(res.body.total).toBe(1);
      });
    });

    it('excluir: some da lista, 404 depois, evento PRODUTO_REMOVIDO e o nome pode ser reutilizado', async () => {
      const tmp = (await call('post', '/stock/products', 'admina', newProduct({ name: 'Descartável', quantity: 3 }))).body;
      const del = await call('delete', `/stock/products/${tmp.id}`, 'admina');
      expect(del.status).toBe(200);
      expect(del.text).toBe('');
      const event = (await eventsOf(orgA)).pop();
      expect(event).toMatchObject({ type: 'PRODUTO_REMOVIDO', subject_name: 'Descartável', description: 'Produto Descartável removido.', metadata: null });

      expect((await call('get', `/stock/products/${tmp.id}`, 'admina')).status).toBe(404);
      expect((await call('patch', `/stock/products/${tmp.id}`, 'admina', { quantity: 1 })).status).toBe(404);
      expect((await call('delete', `/stock/products/${tmp.id}`, 'admina')).status).toBe(404);
      expect((await call('get', '/stock/products?search=descart', 'admina')).body.data).toEqual([]);
      const row = (await dataSource.query('SELECT is_active, updated_by FROM products WHERE id = $1', [tmp.id]))[0];
      expect(row).toEqual({ is_active: false, updated_by: ids.admina });

      const again = await call('post', '/stock/products', 'admina', newProduct({ name: 'Descartável', quantity: 3 }));
      expect(again.status).toBe(201);
      expect(again.body.id).not.toBe(tmp.id);
    });
  });

  // ---------------------------------------------------------------- tipo em uso

  describe('exclusão de tipo com produtos', () => {
    it('conta produtos ativos vinculados em tempo real', async () => {
      const typeId = (await call('post', '/stock/product-types', 'admina', { name: 'Em uso' })).body.id;
      ids.emUso = typeId;
      expect((await call('get', `/stock/product-types/${typeId}/usage`, 'typesview')).body).toEqual({ activeProductsCount: 0 });
      const mk = (name: string) => call('post', '/stock/products', 'admina', { name, productTypeId: typeId, unit: 'UNIT', quantity: 2 });
      const first = (await mk('Item uso 1')).body;
      ids.itemUso1 = first.id;
      await mk('Item uso 2');
      const third = (await mk('Item uso 3')).body;
      expect((await call('get', `/stock/product-types/${typeId}/usage`, 'typesview')).body).toEqual({ activeProductsCount: 3 });
      await call('delete', `/stock/products/${third.id}`, 'admina');
      expect((await call('get', `/stock/product-types/${typeId}/usage`, 'typesview')).body).toEqual({ activeProductsCount: 2 });
    });

    it('excluir o tipo é permitido: some de lista e opções, produtos mantêm o nome, evento com a contagem', async () => {
      const res = await call('delete', `/stock/product-types/${ids.emUso}`, 'admina');
      expect(res.status).toBe(200);
      const event = (await eventsOf(orgA)).pop();
      expect(event).toMatchObject({ type: 'TIPO_REMOVIDO', subject_name: 'Em uso', description: 'Tipo de produto Em uso removido.', metadata: { activeProductsCount: 2 } });

      const types = (await call('get', '/stock/product-types?limit=100', 'admina')).body.data.map((t: any) => t.id);
      expect(types).not.toContain(ids.emUso);
      expect((await call('get', '/stock/product-types/options', 'viewer')).body.map((t: any) => t.id)).not.toContain(ids.emUso);
      expect((await call('get', `/stock/product-types/${ids.emUso}/usage`, 'admina')).status).toBe(404);
      expect((await call('delete', `/stock/product-types/${ids.emUso}`, 'admina')).status).toBe(404);

      // Filtrar por tipo excluído devolve lista vazia, mesmo com produtos ativos ainda vinculados a ele
      const filtered = await call('get', `/stock/products?productTypeId=${ids.emUso}`, 'viewer');
      expect(filtered.status).toBe(200);
      expect(filtered.body).toMatchObject({ data: [], total: 0 });

      const product = await call('get', `/stock/products/${ids.itemUso1}`, 'viewer');
      expect(product.body.productType).toEqual({ id: ids.emUso, name: 'Em uso', isActive: false });
      const listed = (await call('get', '/stock/products?search=item uso', 'viewer')).body.data;
      expect(listed).toHaveLength(2);
      expect(listed.every((p: any) => p.productType.name === 'Em uso')).toBe(true);
    });

    it('produto com tipo excluído: edita outros campos mantendo o tipo; trocar para tipo excluído é 400; criar nele é 400', async () => {
      const edit = await call('patch', `/stock/products/${ids.itemUso1}`, 'admina', { quantity: 9 });
      expect(edit.status).toBe(200);
      expect(edit.body).toMatchObject({ quantity: '9.000', productType: { id: ids.emUso, isActive: false } });
      expect((await call('patch', `/stock/products/${ids.itemUso1}`, 'admina', { quantity: 5, productTypeId: ids.emUso })).status).toBe(200);

      const swap = await call('patch', `/stock/products/${ids.premium}`, 'admina', { productTypeId: ids.emUso });
      expect(swap.status).toBe(400);
      expect(swap.body.message).toBe('Este tipo de produto foi excluído. Escolha outro.');
      const create = await call('post', '/stock/products', 'admina', { name: 'Novo no excluído', productTypeId: ids.emUso, unit: 'UNIT', quantity: 1 });
      expect(create.status).toBe(400);

      // pode trocar para um tipo ativo
      expect((await call('patch', `/stock/products/${ids.itemUso1}`, 'admina', { productTypeId: ids.higiene })).body.productType).toMatchObject({ id: ids.higiene, isActive: true });
    });

    it('o nome de um tipo excluído pode ser usado em um tipo novo (registro diferente)', async () => {
      const again = await call('post', '/stock/product-types', 'admina', { name: 'Em uso' });
      expect(again.status).toBe(201);
      expect(again.body.id).not.toBe(ids.emUso);
    });
  });

  // ---------------------------------------------------------------- histórico

  describe('histórico', () => {
    const history = (qs = '', who = 'historyview') => call('get', `/stock/history${qs ? `?${qs}` : ''}`, who);

    it('lista os eventos do mais recente para o mais antigo, com snapshots e sem campos internos', async () => {
      const res = await history('limit=100');
      expect(res.status).toBe(200);
      const created = res.body.data.map((e: any) => new Date(e.createdAt).getTime());
      expect([...created].sort((a, b) => b - a)).toEqual(created);
      expect(Object.keys(res.body.data[0]).sort()).toEqual(
        ['createdAt', 'description', 'id', 'metadata', 'previousSubjectName', 'productId', 'productTypeId', 'subjectName', 'type', 'userId', 'userName'].sort(),
      );
      const types = new Set(res.body.data.map((e: any) => e.type));
      expect(types).toEqual(new Set(['PRODUTO_CRIADO', 'PRODUTO_EDITADO', 'PRODUTO_REMOVIDO', 'TIPO_CRIADO', 'TIPO_RENOMEADO', 'TIPO_REMOVIDO']));
      const productEvent = res.body.data.find((e: any) => e.type === 'PRODUTO_CRIADO');
      expect(productEvent).toMatchObject({ productTypeId: null, userId: ids.admina, userName: 'Pessoa admina' });
      expect(res.body.data.find((e: any) => e.type === 'TIPO_CRIADO')).toMatchObject({ productId: null });
    });

    it('filtra por tipo de evento', async () => {
      const res = await history('type=TIPO_RENOMEADO&limit=100');
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data.every((e: any) => e.type === 'TIPO_RENOMEADO')).toBe(true);
      expect((await history('type=OUTRO')).status).toBe(400);
    });

    it('opções de usuário: quem aparece no histórico da organização, mesmo removido, pelo nome gravado', async () => {
      const users = await call('get', '/stock/history/users', 'historyview');
      expect(users.body).toEqual([{ id: ids.admina, name: 'Pessoa admina' }]);
      // O nome gravado não muda se o usuário for renomeado depois
      await userRepo.update({ id: ids.admina }, { fullName: 'Admin Renomeada' });
      expect((await call('get', '/stock/history/users', 'historyview')).body).toEqual([{ id: ids.admina, name: 'Pessoa admina' }]);
      const old = await history('limit=100');
      expect(old.body.data.every((e: any) => e.userName === 'Pessoa admina')).toBe(true);
      // Ação nova usa o nome atual
      await call('post', '/stock/product-types', 'admina', { name: 'Depois de renomear' });
      expect((await call('get', '/stock/history/users', 'historyview')).body).toEqual([{ id: ids.admina, name: 'Admin Renomeada' }]);
      expect((await history(`userId=${ids.admina}`)).body.total).toBeGreaterThan(0);
      expect((await history(`userId=${ids.viewer}`)).body.data).toEqual([]);
      expect((await history('userId=x')).status).toBe(400);
    });

    it('busca por qualquer nome que o tipo já teve traz todos os eventos dele, sem acento e maiúscula', async () => {
      // Ração: criado como "Ração", renomeado para "RAÇÃO" e de volta (eventos TIPO_*)
      const byOld = await history('search=raç&limit=100');
      const byNew = await history('search=RACAO&limit=100');
      const typeEvents = (res: any) => res.body.data.filter((e: any) => e.productTypeId === ids.racao).map((e: any) => e.type).sort();
      expect(typeEvents(byOld)).toEqual(['TIPO_CRIADO', 'TIPO_RENOMEADO', 'TIPO_RENOMEADO']);
      expect(typeEvents(byNew)).toEqual(typeEvents(byOld));
    });

    it('busca pelo nome novo do produto traz os eventos antigos (inclusive o PRODUTO_CRIADO gravado com o nome velho)', async () => {
      // "Ração Premium" -> "Ração Super" -> "Ração Premium" (testes de produto); renomeia para um nome inédito
      const areia = (await call('post', '/stock/products', 'admina', { name: 'Areia', productTypeId: ids.higiene, unit: 'KG', quantity: 5 })).body;
      await call('patch', `/stock/products/${areia.id}`, 'admina', { name: 'Areia higiênica' });
      const res = await history('search=HIGIENICA&limit=100');
      const events = res.body.data.filter((e: any) => e.productId === areia.id);
      expect(events.map((e: any) => [e.type, e.subjectName]).sort()).toEqual([
        ['PRODUTO_CRIADO', 'Areia'],
        ['PRODUTO_EDITADO', 'Areia higiênica'],
      ]);
      expect(events.find((e: any) => e.type === 'PRODUTO_EDITADO').previousSubjectName).toBe('Areia');
      const byOldName = await history('search=areia&limit=100');
      expect(byOldName.body.data.filter((e: any) => e.productId === areia.id)).toHaveLength(2);
      // A busca "higienica" não traz eventos de outros itens, e o termo escapado é literal
      expect(res.body.data.every((e: any) => e.productId === areia.id)).toBe(true);
      expect((await history('search=%25&limit=100')).body.data).toEqual([]);
    });

    it('buscar o nome de um tipo não traz o PRODUTO_EDITADO que trocou o tipo do produto', async () => {
      const prod = (await call('post', '/stock/products', 'admina', { name: 'Troca de tipo', productTypeId: ids.medicamento, unit: 'UNIT', quantity: 1 })).body;
      await call('patch', `/stock/products/${prod.id}`, 'admina', { productTypeId: ids.higiene });
      const res = await history('search=medicamento&limit=100');
      expect(res.body.data.some((e: any) => e.type === 'PRODUTO_EDITADO' && e.productId === prod.id)).toBe(false);
      expect(res.body.data.some((e: any) => e.productTypeId === ids.medicamento)).toBe(true);
      // O metadata do evento tem o nome do tipo (snapshot), mas a busca só olha o nome do item
      const edited = (await history('search=troca de tipo&type=PRODUTO_EDITADO')).body.data[0];
      expect(edited.metadata.fields[0]).toMatchObject({ field: 'productTypeId', beforeName: 'medicamento', afterName: 'Higiene' });
    });

    it('filtros de busca e tipo de evento combinam (aplicam aos eventos devolvidos)', async () => {
      const res = await history('search=higienica&type=PRODUTO_CRIADO&limit=100');
      expect(res.body.data.map((e: any) => [e.type, e.subjectName])).toEqual([['PRODUTO_CRIADO', 'Areia']]);
    });

    it('período em dia local de Brasília; invertido é 400', async () => {
      const dayOf = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(iso));
      const first = (await history('limit=100')).body.data.slice(-1)[0];
      const day = dayOf(first.createdAt);
      expect((await history(`from=${day}&to=${day}&limit=100`)).body.data.map((e: any) => e.id)).toContain(first.id);
      expect((await history('from=2000-01-01&to=2000-01-02')).body.data).toEqual([]);
      const inverted = await history('from=2026-10-15&to=2026-10-10');
      expect(inverted.status).toBe(400);
      expect(inverted.body.message).toBe('A data inicial não pode ser maior que a final.');
    });

    it('B (Admin) vê só os eventos da organização B', async () => {
      const res = await call('get', '/stock/history?limit=100', 'adminb');
      expect(res.status).toBe(200);
      expect(res.body.data.map((e: any) => e.subjectName).sort()).toEqual(['Ração', 'Ração Premium']);
      expect((await call('get', '/stock/history/users', 'adminb')).body).toEqual([{ id: ids.adminb, name: 'Pessoa adminb' }]);
      // A busca na B não encontra itens da A
      expect((await call('get', '/stock/history?search=areia', 'adminb')).body.data).toEqual([]);
    });
  });

  // ---------------------------------------------------------------- robustez de entrada

  describe('entrada inválida', () => {
    const NUL = 'a b';
    const nullByteMessage = 'O texto enviado contém caracteres inválidos (byte nulo).';

    it('byte nulo em nome, observações ou busca é 400 em PT-BR (não 500) e nada é gravado', async () => {
      const before = await countEvents(orgA);
      const requests = await Promise.all([
        call('post', '/stock/product-types', 'admina', { name: NUL }),
        call('patch', `/stock/product-types/${ids.higiene}`, 'admina', { name: NUL }),
        call('post', '/stock/products', 'admina', { name: NUL, productTypeId: ids.racao, unit: 'UNIT', quantity: 1 }),
        call('post', '/stock/products', 'admina', { name: 'Com nulo', productTypeId: ids.racao, unit: 'UNIT', quantity: 1, notes: NUL }),
        call('patch', `/stock/products/${ids.premium}`, 'admina', { name: NUL }),
        call('patch', `/stock/products/${ids.premium}`, 'admina', { notes: NUL }),
        call('get', '/stock/products?search=a%00b', 'viewer'),
        call('get', '/stock/history?search=a%00b', 'historyview'),
        call('get', '/stock/history?userId=%00', 'historyview'),
      ]);
      expect(requests.map((r) => r.status)).toEqual(Array(9).fill(400));
      expect(requests.every((r) => JSON.stringify(r.body.message).includes(nullByteMessage) || r.status === 400)).toBe(true);
      expect(requests[0].body.message).toBe(nullByteMessage);
      expect(await countEvents(orgA)).toBe(before);
      expect((await call('get', '/stock/products?search=com nulo', 'viewer')).body.data).toEqual([]);
    });

    it('a correção vale também para rotas existentes (pets) e não muda busca válida', async () => {
      const res = await call('get', '/pets?search=a%00b', 'admina');
      expect(res.status).toBe(400);
      expect(res.body.message).toBe(nullByteMessage);
      expect((await call('get', '/pets?search=bolinha', 'admina')).status).toBe(200);
      expect((await call('get', '/stock/products?search=ra%C3%A7%C3%A3o', 'viewer')).status).toBe(200);
    });

    it('nome com controle, bidi ou largura zero é 400 "caracteres inválidos"; nome com emoji é 400 "emojis"', async () => {
      const post = (name: string) => call('post', '/stock/products', 'admina', { name, productTypeId: ids.racao, unit: 'UNIT', quantity: 1 });
      for (const name of ['a\u0007b', 'abc\u202Edef', 'a\u200Bb', '\u2066x', 'a\u200Db']) {
        const type = await call('post', '/stock/product-types', 'admina', { name });
        expect(type.status).toBe(400);
        expect(type.body.message).toEqual(['O nome contém caracteres inválidos.']);
        expect((await post(name)).body.message).toEqual(['O nome contém caracteres inválidos.']);
      }
      const emojis = [
        'Petisco \u{1F356}',
        '\u{1F469}\u{1F3FD}\u200D\u{1F4BB}',
        '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}',
        '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}',
        '\u2764\uFE0F',
        '\u{1F1E7}\u{1F1F7}',
        '1\uFE0F\u20E3',
      ];
      for (const name of emojis) {
        const type = await call('post', '/stock/product-types', 'admina', { name });
        expect(type.status).toBe(400);
        expect(type.body.message).toEqual(['O nome não pode conter emojis.']);
        expect((await post(name)).body.message).toEqual(['O nome não pode conter emojis.']);
      }
      expect((await call('patch', `/stock/products/${ids.premium}`, 'admina', { name: 'x\u202Ey' })).status).toBe(400);
      expect((await call('patch', `/stock/product-types/${ids.higiene}`, 'admina', { name: 'x\u200By' })).status).toBe(400);
      expect((await call('patch', `/stock/products/${ids.premium}`, 'admina', { name: 'x \u{1F436}' })).body.message).toEqual(['O nome não pode conter emojis.']);
      expect((await call('patch', `/stock/product-types/${ids.higiene}`, 'admina', { name: '\u{1F1E7}\u{1F1F7}' })).body.message).toEqual(['O nome não pode conter emojis.']);

      // Nome legítimo com dígitos, # e pontuação passa
      const ok = await call('post', '/stock/products', 'admina', { name: 'Ração 10kg #2', productTypeId: ids.racao, unit: 'UNIT', quantity: 1 });
      expect(ok.status).toBe(201);
      expect(ok.body.name).toBe('Ração 10kg #2');
    });

    it('observações: controles são removidos em silêncio, quebra de linha e emoji ficam; NUL é barrado antes (400 do middleware)', async () => {
      const created = await call('post', '/stock/products', 'admina', {
        name: 'Obs limpa',
        productTypeId: ids.racao,
        unit: 'UNIT',
        quantity: 1,
        notes: 'a\u0007b\u007Fc\u0085d\nlinha 2\tok \u{1F436}',
      });
      expect(created.status).toBe(201);
      expect(created.body.notes).toBe('abcd\nlinha 2\tok \u{1F436}');
      const edited = await call('patch', `/stock/products/${created.body.id}`, 'admina', { notes: '\u0007x\u001By' });
      expect(edited.status).toBe(200);
      expect(edited.body.notes).toBe('xy');
      // Só controles = vazio = null
      expect((await call('patch', `/stock/products/${created.body.id}`, 'admina', { notes: '\u0007\u007F' })).body.notes).toBeNull();
      // A limpeza vem antes do limite de 1000: 1000 úteis + controles passa; 1001 úteis não
      const exact = await call('post', '/stock/products', 'admina', { name: 'Obs limite', productTypeId: ids.racao, unit: 'UNIT', quantity: 1, notes: 'a'.repeat(1000) + '\u0007'.repeat(30) });
      expect(exact.status).toBe(201);
      expect(exact.body.notes).toHaveLength(1000);
      const over = await call('post', '/stock/products', 'admina', { name: 'Obs limite 2', productTypeId: ids.racao, unit: 'UNIT', quantity: 1, notes: 'a'.repeat(1001) + '\u0007' });
      expect(over.body.message).toEqual(['As observações podem ter até 1.000 caracteres.']);
      // Nome com tab, \n e \r vira espaço e é aceito
      const spaced = await call('post', '/stock/products', 'admina', { name: 'Nome\tcom\r\nquebra', productTypeId: ids.racao, unit: 'UNIT', quantity: 1 });
      expect(spaced.status).toBe(201);
      expect(spaced.body.name).toBe('Nome com quebra');
      // O byte nulo é recusado pelo middleware global, antes da validação do campo
      const nul = await call('post', '/stock/products', 'admina', { name: 'Obs nul', productTypeId: ids.racao, unit: 'UNIT', quantity: 1, notes: 'a\u0000b' });
      expect(nul.status).toBe(400);
      expect(nul.body.message).toBe('O texto enviado contém caracteres inválidos (byte nulo).');
    });

    it('nome ausente devolve uma única mensagem, sem a de tamanho nem repetida', async () => {
      const product = await call('post', '/stock/products', 'admina', { productTypeId: ids.racao, unit: 'UNIT', quantity: 1 });
      expect(product.status).toBe(400);
      expect(product.body.message).toEqual(['Informe o nome do produto.']);
      const type = await call('post', '/stock/product-types', 'admina', {});
      expect(type.body.message).toEqual(['Informe o nome do tipo.']);
    });

    it('search repetido (array) devolve mensagem em PT-BR', async () => {
      const products = await call('get', '/stock/products?search=a&search=b', 'viewer');
      expect(products.status).toBe(400);
      expect(products.body.message).toEqual(['Busca deve ser um texto.']);
      expect((await call('get', '/stock/history?search=a&search=b', 'historyview')).body.message).toEqual(['Busca deve ser um texto.']);
    });
  });

  // ---------------------------------------------------------------- transação

  describe('atomicidade com o histórico', () => {
    it('se o evento não puder ser gravado, a ação inteira é desfeita', async () => {
      // Check do banco recusa evento TIPO_RENOMEADO sem nome anterior; força a falha com um trigger de teste
      await dataSource.query(`
        CREATE OR REPLACE FUNCTION fail_stock_history() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'falha simulada'; END; $$ LANGUAGE plpgsql;
        DROP TRIGGER IF EXISTS trg_fail_stock_history ON stock_history_events;
        CREATE TRIGGER trg_fail_stock_history BEFORE INSERT ON stock_history_events FOR EACH ROW EXECUTE FUNCTION fail_stock_history();
      `);
      try {
        const before = await dataSource.query('SELECT count(*)::int AS n FROM products WHERE organization_id = $1', [orgA]);
        const create = await call('post', '/stock/products', 'admina', { name: 'Fantasma', productTypeId: ids.racao, unit: 'UNIT', quantity: 1 });
        expect(create.status).toBe(500);
        expect(await dataSource.query('SELECT count(*)::int AS n FROM products WHERE organization_id = $1', [orgA])).toEqual(before);

        const edit = await call('patch', `/stock/products/${ids.premium}`, 'admina', { quantity: 77 });
        expect(edit.status).toBe(500);
        expect((await call('get', `/stock/products/${ids.premium}`, 'admina')).body.quantity).not.toBe('77.000');

        const rename = await call('patch', `/stock/product-types/${ids.higiene}`, 'admina', { name: 'Higiene 2' });
        expect(rename.status).toBe(500);
        expect((await call('get', '/stock/product-types?limit=100', 'admina')).body.data.some((t: any) => t.name === 'Higiene')).toBe(true);
      } finally {
        await dataSource.query('DROP TRIGGER IF EXISTS trg_fail_stock_history ON stock_history_events; DROP FUNCTION IF EXISTS fail_stock_history();');
      }
    });
  });

  // ---------------------------------------------------------------- paginação global

  describe('limit máximo 100 em rotas paginadas (novas e existentes)', () => {
    it.each([
      '/stock/products',
      '/stock/product-types',
      '/stock/history',
      '/pets',
      '/partners',
      '/campaigns',
      '/teams',
      '/volunteers',
      '/bank-accounts',
      '/financial/entries',
      '/financial/expenses',
      '/adoption-forms',
      '/adoption-history',
    ])('%s: limit=500 responde 200 com limit 100; limit=100 é aceito; limit=0 é 400', async (path) => {
      const over = await call('get', `${path}?limit=500`, 'admina');
      expect(over.status).toBe(200);
      expect(over.body.limit).toBe(100);
      expect(over.body.data.length).toBeLessThanOrEqual(100);

      const exact = await call('get', `${path}?limit=100`, 'admina');
      expect(exact.status).toBe(200);
      expect(exact.body.limit).toBe(100);

      const def = await call('get', path, 'admina');
      expect(def.body.limit).toBe(10);

      expect((await call('get', `${path}?limit=0`, 'admina')).status).toBe(400);
    });
  });
});
