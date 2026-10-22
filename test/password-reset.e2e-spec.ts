import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { TestAppModule, joinTeam, cleanupAccess } from './test-app.module';
import { Profile } from '../src/profile/profile.entity';
import { Organization } from '../src/organization/organization.entity';
import { User } from '../src/user/user.entity';
import { MailService } from '../src/mail/mail.service';
import { TeamService } from '../src/team/team.service';
import { TeamMembershipService } from '../src/team/team-membership.service';
import { TeamSystemKey } from '../src/team/team.entity';

const GENERIC = 'Se este e-mail tiver acesso ao painel, enviamos um código. Confira a caixa de entrada e o spam.';
const INVALID = 'Código inválido ou expirado.';
const EXPIRED = 'Este pedido expirou. Comece de novo.';
const SECRET = process.env.JWT_SECRET;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type MockMail = {
  lastPasswordResetCode: string | null;
  passwordResetCodeSentTo: string[];
  passwordChangedSentTo: string[];
  sendPasswordResetEmail: (...args: unknown[]) => Promise<void>;
};

describe('Esqueci minha senha, sessões e volante (e2e)', () => {
  let app: INestApplication;
  let moduleFixture: TestingModule;
  let dataSource: DataSource;
  let userRepo: Repository<User>;
  let orgRepo: Repository<Organization>;
  let mail: MockMail;
  let jwt: JwtService;
  let orgId: string;
  let otherOrgId: string;
  let profileId: string;
  let adminId: string;
  let adminToken: string;
  let otherAdminToken: string;
  let floatingTeamId: string;
  let seq = 0;
  const logs: string[] = [];

  const server = () => app.getHttpServer();
  // IP novo a cada chamada: o throttle por IP é testado à parte, com IP fixo
  const nextIp = () => `10.${Math.floor(seq / 60000) % 250}.${Math.floor(seq / 250) % 250}.${(seq++ % 250) + 1}`;
  const post = (path: string, body: object, ip = nextIp()) => request(server()).post(path).set('X-Forwarded-For', ip).send(body);
  const forgot = (email: string, ip?: string) => post('/auth/forgot-password', { email }, ip);
  const verify = (email: string, code: string, ip?: string) => post('/auth/forgot-password/verify', { email, code }, ip);
  const reset = (resetToken: string, password: string, ip?: string) => post('/auth/reset-password', { resetToken, password }, ip);
  const login = (email: string, password = 'senha123') => request(server()).post('/auth/login').send({ email, password });
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const me = (token: string) => request(server()).get('/auth/me').set(bearer(token));
  const tokenOf = async (email: string, password = 'senha123') => (await login(email, password)).body.access_token as string;
  const wrongCodeFor = (code: string) => (code === '000000' ? '000001' : '000000');

  const createUser = async (name: string, overrides: Partial<User> = {}, organizationId = orgId) =>
    userRepo.save(
      userRepo.create({
        fullName: name,
        cpf: String(11000000000 + ++seq),
        email: `${name.toLowerCase().replace(/\s+/g, '.')}@reset.teste.com`,
        phone: '11900000000',
        password: await bcrypt.hash('senha123', 4),
        profileId,
        organizationId,
        isConfirmed: true,
        isApproved: true,
        isActive: true,
        ...overrides,
      }),
    );
  /** Voluntário fixo com acesso a Pets (Visualizar) */
  const createFixed = async (name: string, overrides: Partial<User> = {}) => {
    const user = await createUser(name, overrides);
    await joinTeam(app, user, { PETS: 'VIEW' } as any);
    return user;
  };
  const createFloating = async (name: string, overrides: Partial<User> = {}) => {
    const user = await createUser(name, overrides);
    await app.get(TeamMembershipService).assign({ birthDate: null, ...user }, floatingTeamId, null);
    return user;
  };

  /** Espera o código chegar: o envio acontece depois da resposta. */
  const waitForCode = async (previous: string | null = mail.lastPasswordResetCode, timeout = 8000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (mail.lastPasswordResetCode && mail.lastPasswordResetCode !== previous) return mail.lastPasswordResetCode;
      await sleep(25);
    }
    throw new Error('o código não chegou por e-mail a tempo');
  };
  /** Pede um código e devolve o que chegou. Zera o cooldown da conta antes, para poder pedir de novo. */
  const requestCode = async (email: string) => {
    const user = await userRepo.findOne({ where: { email } });
    await shiftCodes(user.id, '61 seconds');
    const previous = mail.lastPasswordResetCode;
    const res = await forgot(email);
    expect(res.status).toBe(200);
    return waitForCode(previous);
  };
  /** Envelhece os códigos da conta (created_at e expires_at juntos, para o check de expiração continuar valendo). */
  const shiftCodes = (userId: string, interval: string) =>
    dataSource.query(`UPDATE password_reset_codes SET created_at = created_at - interval '${interval}', expires_at = expires_at - interval '${interval}' WHERE user_id = $1`, [userId]);
  const codesOf = (userId: string) => dataSource.query('SELECT * FROM password_reset_codes WHERE user_id = $1 ORDER BY created_at', [userId]);
  const withoutDate = (headers: Record<string, string>) => {
    const { date: _date, ...rest } = headers;
    return rest;
  };

  beforeAll(async () => {
    moduleFixture = await Test.createTestingModule({ imports: [TestAppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    // Atrás do proxy, como no Railway: o throttle usa o IP do X-Forwarded-For
    app.getHttpAdapter().getInstance().set('trust proxy', true);
    await app.init();
    await app.listen(0);

    dataSource = moduleFixture.get(DataSource);
    userRepo = moduleFixture.get(getRepositoryToken(User));
    orgRepo = moduleFixture.get(getRepositoryToken(Organization));
    const profileRepo: Repository<Profile> = moduleFixture.get(getRepositoryToken(Profile));
    mail = app.get(MailService) as unknown as MockMail;
    jwt = app.get(JwtService);

    // Eventos de segurança (CA-70): o Logger do Nest vai para um array, sem poluir a saída
    for (const level of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((message: unknown) => {
        logs.push(String(message));
      });
    }

    for (const cnpj of ['77777777777771', '77777777777772']) {
      const existing = await orgRepo.findOne({ where: { cnpj } });
      if (existing) {
        await cleanupAccess(app, existing.id);
        await userRepo.delete({ organizationId: existing.id });
        await orgRepo.delete({ id: existing.id });
      }
    }
    if (!(await profileRepo.findOne({ where: { name: 'VOLUNTEER' } }))) await profileRepo.save([{ name: 'ADMIN' }, { name: 'FINANCIAL' }, { name: 'VOLUNTEER' }]);
    profileId = (await profileRepo.findOne({ where: { name: 'VOLUNTEER' } })).id;
    orgId = (await orgRepo.save({ legalName: 'Org Reset', cnpj: '77777777777771' })).id;
    otherOrgId = (await orgRepo.save({ legalName: 'Org Reset Outra', cnpj: '77777777777772' })).id;

    const admin = await createUser('Admin Reset');
    adminId = admin.id;
    await joinTeam(app, admin, 'ADMIN');
    const otherAdmin = await createUser('Admin Outra', {}, otherOrgId);
    await joinTeam(app, otherAdmin, 'ADMIN');
    floatingTeamId = (await app.get(TeamService).systemTeam(orgId, TeamSystemKey.FLOATING_VOLUNTEER)).id;
    adminToken = await tokenOf(admin.email);
    otherAdminToken = await tokenOf(otherAdmin.email);
  }, 60000);

  afterAll(async () => {
    for (const id of [orgId, otherOrgId]) {
      await cleanupAccess(app, id);
      await userRepo.delete({ organizationId: id });
      await orgRepo.delete({ id });
    }
    await app.close();
    jest.restoreAllMocks();
  }, 60000);

  describe('fluxo completo e sessões (CA-01, CA-12, CA-17, CA-22, CA-38, CA-45, CA-46)', () => {
    it('pede o código, valida, troca a senha, avisa por e-mail e derruba as sessões abertas', async () => {
      const maria = await createFixed('Maria Fluxo');
      const [sessionA, sessionB] = [await tokenOf(maria.email), await tokenOf(maria.email)];
      expect((await me(sessionA)).status).toBe(200);
      // A comparação do guard é em segundos inteiros: as sessões velhas precisam ser de um segundo anterior à troca
      await sleep(1100);

      const asked = await forgot('Maria.Fluxo@RESET.teste.com');
      expect(asked.status).toBe(200);
      expect(asked.body).toEqual({ message: GENERIC });
      const code = await waitForCode();
      expect(code).toMatch(/^\d{6}$/);
      expect(mail.passwordResetCodeSentTo).toContain(maria.email);

      const verified = await verify(maria.email, code);
      expect(verified.status).toBe(200);
      expect(Object.keys(verified.body)).toEqual(['resetToken']);
      // Código usado: repetir devolve INVALID
      const again = await verify(maria.email, code);
      expect(again.status).toBe(400);
      expect(again.body.message).toBe(INVALID);

      const changed = await reset(verified.body.resetToken, 'NovaSenha#2026');
      expect(changed.status).toBe(200);
      expect(changed.body).toEqual({ message: 'Senha alterada com sucesso.' });
      expect(mail.passwordChangedSentTo).toContain(maria.email);

      expect((await login(maria.email, 'NovaSenha#2026')).status).toBe(201);
      const oldLogin = await login(maria.email, 'senha123');
      expect(oldLogin.status).toBe(401);
      expect(oldLogin.body.message).toBe('Credenciais inválidas.');

      // As duas sessões abertas antes caem em qualquer rota protegida (CA-22, CA-38)
      const sessions = [sessionA, sessionB];
      for (const token of sessions) {
        expect((await me(token)).status).toBe(401);
        expect((await request(server()).get(`/users/${maria.id}`).set(bearer(token))).status).toBe(401);
        expect((await request(server()).patch('/users/me/password').set(bearer(token)).send({ currentPassword: 'NovaSenha#2026', newPassword: 'OutraSenha#1' })).status).toBe(401);
      }
      const fresh = await tokenOf(maria.email, 'NovaSenha#2026');
      expect((await me(fresh)).status).toBe(200);
      expect((await request(server()).get(`/users/${maria.id}`).set(bearer(fresh))).status).toBe(200);
    }, 40000);

    it('troca pelo perfil devolve token novo: a sessão atual continua e as outras caem (CA-45, CA-46)', async () => {
      const user = await createFixed('Paulo Perfil');
      const [browserA, browserB] = [await tokenOf(user.email), await tokenOf(user.email)];
      await sleep(1100);

      const wrong = await request(server()).patch('/users/me/password').set(bearer(browserA)).send({ currentPassword: 'errada', newPassword: 'NovaSenha#2026' });
      expect(wrong.status).toBe(400);
      expect((await me(browserB)).status).toBe(200);

      const changed = await request(server()).patch('/users/me/password').set(bearer(browserA)).send({ currentPassword: 'senha123', newPassword: 'NovaSenha#2026' });
      expect(changed.status).toBe(200);
      expect(changed.body).toEqual({ message: 'Senha alterada com sucesso.', access_token: expect.any(String) });
      expect(mail.passwordChangedSentTo).toContain(user.email);

      // Token novo vale na hora (mesmo segundo da troca, RN-30); o antigo do A e o do B caem
      expect((await me(changed.body.access_token)).status).toBe(200);
      expect((await me(browserA)).status).toBe(401);
      expect((await me(browserB)).status).toBe(401);
      expect((await login(user.email, 'NovaSenha#2026')).status).toBe(201);
    }, 30000);

    it('reset pela tela Voluntários derruba as sessões do usuário e mantém a de quem executou (CA-44)', async () => {
      const user = await createFixed('Rita Reset');
      const session = await tokenOf(user.email);
      await sleep(1100);
      const before = (await userRepo.findOne({ where: { id: user.id }, select: { id: true, password: true } })).password;

      const res = await request(server()).patch(`/users/${user.id}/reset-password`).set(bearer(adminToken));

      expect(res.status).toBe(200);
      expect((await userRepo.findOne({ where: { id: user.id }, select: { id: true, password: true } })).password).not.toBe(before);
      expect((await me(session)).status).toBe(401);
      expect((await me(adminToken)).status).toBe(200);
    }, 20000);
  });

  describe('quem não recebe código (CA-02, CA-03, CA-04, CA-47)', () => {
    it('volante, inativo, não confirmado, pendente, sem equipe e e-mail inexistente: mesma resposta, nenhum código e nenhum e-mail', async () => {
      const floating = await createFloating('Vera Volante');
      const floatingWithAccess = await createFloating('Vitor Volante Acesso');
      const team = await app.get(TeamService).setPermissions(floatingTeamId, { PETS: 'VIEW' } as any);
      expect(team).toBeDefined();
      const inactive = await createFixed('Ines Inativa', { isActive: false });
      const unconfirmed = await createFixed('Caio Naoconfirmado', { isConfirmed: false });
      const pending = await createFixed('Pedro Pendente', { isApproved: false });
      const noTeam = await createUser('Sonia Semequipe');
      const eligible = await createFixed('Elisa Elegivel');
      const emails = [floating.email, floatingWithAccess.email, inactive.email, unconfirmed.email, pending.email, noTeam.email, 'ninguem@reset.teste.com'];

      const before = mail.passwordResetCodeSentTo.length;
      const responses = [];
      for (const email of emails) responses.push(await forgot(email));
      const eligibleRes = await forgot(eligible.email);
      await waitForCode();
      await sleep(300);

      for (const res of [...responses, eligibleRes]) {
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ message: GENERIC });
      }
      expect(mail.passwordResetCodeSentTo.slice(before)).toEqual([eligible.email]);
      for (const user of [floating, floatingWithAccess, inactive, unconfirmed, pending, noTeam]) expect(await codesOf(user.id)).toHaveLength(0);
      await app.get(TeamService).setPermissions(floatingTeamId, {});
    }, 40000);

    it('status, corpo e headers idênticos em todos os casos, sem 429 por conta (CA-47)', async () => {
      const eligible = await createFixed('Edu Snapshot');
      const volante = await createFloating('Vini Snapshot');
      const hourly = await createFixed('Hora Snapshot');
      const daily = await createFixed('Dia Snapshot');
      const locked = await createFixed('Lock Snapshot');
      const insertClosed = (userId: string, minutesAgo: number) =>
        dataSource.query(
          `INSERT INTO password_reset_codes (user_id, code_hash, created_at, expires_at, used_at) VALUES ($1, $2, now() - ($3::int * interval '1 minute'), now() - ($3::int * interval '1 minute') + interval '5 minutes', now())`,
          [userId, 'x'.repeat(60), minutesAgo],
        );
      for (let i = 1; i <= 5; i++) await insertClosed(hourly.id, i * 10);
      for (let i = 0; i < 10; i++) await insertClosed(daily.id, 120 + i * 60);
      await dataSource.query(`UPDATE users SET password_reset_locked_until = now() + interval '1 day' WHERE id = $1`, [locked.id]);

      const first = await forgot(eligible.email);
      await waitForCode();
      const cooldown = await forgot(eligible.email);
      const cases = [first, cooldown, await forgot('nao.existe@reset.teste.com'), await forgot(volante.email), await forgot(hourly.email), await forgot(daily.email), await forgot(locked.email)];
      await sleep(400);

      for (const res of cases) {
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ message: GENERIC });
        expect(withoutDate(res.headers)).toEqual(withoutDate(first.headers));
      }
      // Nada novo nos casos bloqueados (CA-07, CA-48): continuam com as linhas que já tinham
      expect(await codesOf(hourly.id)).toHaveLength(5);
      expect(await codesOf(daily.id)).toHaveLength(10);
      expect(await codesOf(locked.id)).toHaveLength(0);
      expect(mail.passwordResetCodeSentTo).not.toContain(hourly.email);
      expect(mail.passwordResetCodeSentTo).not.toContain(daily.email);
      expect(mail.passwordResetCodeSentTo).not.toContain(locked.email);
      expect(logs).toContain(JSON.stringify({ event: 'password_reset.blocked', userId: daily.id, reason: 'dia' }));
      expect(logs).toContain(JSON.stringify({ event: 'password_reset.blocked', userId: hourly.id, reason: 'hora' }));
      expect(logs).toContain(JSON.stringify({ event: 'password_reset.blocked', userId: locked.id, reason: 'bloqueio' }));
      expect(logs).toContain(JSON.stringify({ event: 'password_reset.blocked', userId: eligible.id, reason: 'cooldown' }));
    }, 40000);

    it('e-mail inexistente e volante: verify responde sempre com a mesma mensagem (CA-15)', async () => {
      const volante = await createFloating('Vilma Verify');
      const wrong = await verify('ninguem@reset.teste.com', '123456');
      const floating = await verify(volante.email, '123456');

      for (const res of [wrong, floating]) {
        expect(res.status).toBe(400);
        expect(res.body).toEqual(expect.objectContaining({ message: INVALID, statusCode: 400 }));
      }
      expect(floating.body).toEqual(wrong.body);
    });

    it('e-mail com formato inválido ou longo demais: 400 PT-BR sem repetir o valor (CA-11, CA-54)', async () => {
      for (const email of ['sem-arroba', `${'a'.repeat(250)}@teste.com`]) {
        const res = await forgot(email);
        expect(res.status).toBe(400);
        expect(JSON.stringify(res.body)).not.toContain(email);
        expect(res.body.message.join(' ')).toMatch(/e-mail/);
      }
      for (const code of ['12345a', '1234567']) {
        const res = await verify('x@teste.com', code);
        expect(res.status).toBe(400);
        expect(res.body.message).toEqual(['O código deve ter 6 dígitos numéricos.']);
        expect(JSON.stringify(res.body)).not.toContain(code);
      }
    });
  });

  describe('limites por conta (CA-06, CA-08, CA-49, CA-50)', () => {
    it('reenvio antes de 60 s não manda e-mail novo e o código anterior continua valendo (CA-06); depois de 60 s só o último vale (CA-08)', async () => {
      const user = await createFixed('Cris Cooldown');
      expect((await forgot(user.email)).status).toBe(200);
      const first = await waitForCode();
      const sent = mail.passwordResetCodeSentTo.length;

      expect((await forgot(user.email)).status).toBe(200);
      await sleep(400);
      expect(mail.passwordResetCodeSentTo.length).toBe(sent);
      expect(await codesOf(user.id)).toHaveLength(1);

      const second = await requestCode(user.email);
      expect(second).not.toBe(first);
      const stale = await verify(user.email, first);
      expect(stale.status).toBe(400);
      expect(stale.body.message).toBe(INVALID);
      expect((await verify(user.email, second)).status).toBe(200);
    }, 30000);

    it('dois pedidos simultâneos mandam um e-mail só e deixam um código válido (CA-49)', async () => {
      const user = await createFixed('Davi Dobrado');
      const sent = mail.passwordResetCodeSentTo.length;

      const [a, b] = await Promise.all([forgot(user.email), forgot(user.email)]);
      await waitForCode();
      await sleep(600);

      expect([a.status, b.status]).toEqual([200, 200]);
      expect(mail.passwordResetCodeSentTo.length - sent).toBe(1);
      const rows = await codesOf(user.id);
      expect(rows).toHaveLength(1);
      expect(rows.filter((row) => row.used_at === null)).toHaveLength(1);
    }, 30000);

    it('o código vale 5 minutos pelo relógio do banco: 4 min 50 s ainda passa, 5 min 1 s não (CA-13)', async () => {
      const user = await createFixed('Edna Expira');
      const late = await requestCode(user.email);
      await shiftCodes(user.id, '301 seconds');
      const tooLate = await verify(user.email, late);
      expect(tooLate.status).toBe(400);
      expect(tooLate.body.message).toBe(INVALID);

      const onTime = await requestCode(user.email);
      await shiftCodes(user.id, '290 seconds');
      expect((await verify(user.email, onTime)).status).toBe(200);
    }, 30000);

    it('5 códigos errados seguidos bloqueiam o código: o certo na 6ª chamada recebe a mesma mensagem (CA-14)', async () => {
      const user = await createFixed('Beto Bloqueio');
      const code = await requestCode(user.email);
      const wrong = wrongCodeFor(code);
      const bodies = [];
      for (let i = 0; i < 5; i++) {
        const res = await verify(user.email, wrong);
        expect(res.status).toBe(400);
        bodies.push(res.body);
      }
      const sixth = await verify(user.email, code);

      expect(sixth.status).toBe(400);
      expect(sixth.body).toEqual(bodies[0]);
      expect(sixth.body).not.toHaveProperty('reason');
      expect(logs.some((line) => line.includes('"event":"password_reset.verify_failed"') && line.includes('"attempts":5'))).toBe(true);
    }, 30000);

    it('50 validações paralelas com código errado: as tentativas terminam em 5 (CA-52)', async () => {
      const user = await createFixed('Paulo Paralelo');
      const code = await requestCode(user.email);
      const wrong = wrongCodeFor(code);

      const results = await Promise.all(Array.from({ length: 50 }, () => verify(user.email, wrong)));

      expect(results.every((res) => res.status === 400 && res.body.message === INVALID)).toBe(true);
      const [row] = await codesOf(user.id);
      expect(row.attempts).toBe(5);
      // Esgotado: nem o código certo passa
      expect((await verify(user.email, code)).status).toBe(400);
    }, 60000);

    it('duas validações simultâneas com o código certo: um token só (CA-53)', async () => {
      const user = await createFixed('Tati Token');
      const code = await requestCode(user.email);

      const results = await Promise.all([verify(user.email, code), verify(user.email, code)]);

      expect(results.map((res) => res.status).sort()).toEqual([200, 400]);
    }, 30000);

    it('15 erros em 3 códigos bloqueiam novos códigos por 24 h; depois de 24 h volta; o login segue funcionando (CA-50)', async () => {
      const user = await createFixed('Lia Limite');
      for (let round = 0; round < 3; round++) {
        const code = await requestCode(user.email);
        for (let i = 0; i < 5; i++) expect((await verify(user.email, wrongCodeFor(code))).status).toBe(400);
      }

      expect(logs).toContain(JSON.stringify({ event: 'password_reset.locked', userId: user.id }));
      const locked = await dataSource.query('SELECT password_reset_locked_until > now() + interval \'23 hours\' AS "long" FROM users WHERE id = $1', [user.id]);
      expect(locked[0].long).toBe(true);

      await shiftCodes(user.id, '61 seconds');
      const rowsBefore = (await codesOf(user.id)).length;
      const sent = mail.passwordResetCodeSentTo.length;
      const blocked = await forgot(user.email);
      await sleep(500);
      expect(blocked.status).toBe(200);
      expect(blocked.body).toEqual({ message: GENERIC });
      expect(mail.passwordResetCodeSentTo.length).toBe(sent);
      expect(await codesOf(user.id)).toHaveLength(rowsBefore);
      // Bloqueio não impede o login com a senha atual
      expect((await login(user.email)).status).toBe(201);

      // Passadas as 24 h: o bloqueio acaba e as falhas saem da janela
      await dataSource.query(`UPDATE users SET password_reset_locked_until = now() - interval '1 second' WHERE id = $1`, [user.id]);
      await shiftCodes(user.id, '25 hours');
      const code = await requestCode(user.email);
      expect(code).toMatch(/^\d{6}$/);
    }, 90000);

    it('usuário que virou volante depois de receber o código: o certo recebe INVALID (CA-16)', async () => {
      const user = await createFixed('Gabi Guinada');
      const code = await requestCode(user.email);
      await app.get(TeamMembershipService).assign({ birthDate: null, ...user }, floatingTeamId, adminId);

      const res = await verify(user.email, code);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(INVALID);
    }, 20000);
  });

  describe('limite por IP (CA-09)', () => {
    it('pedir código: 5 por minuto por IP, o 6º recebe 429 com mensagem PT-BR', async () => {
      const ip = '203.0.113.10';
      const statuses = [];
      let last;
      for (let i = 0; i < 6; i++) {
        last = await forgot('nunca.existiu@reset.teste.com', ip);
        statuses.push(last.status);
      }

      expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
      expect(last.body.message).toBe('Muitas tentativas. Aguarde um minuto e tente de novo.');
      // Outro IP não é afetado
      expect((await forgot('nunca.existiu@reset.teste.com', '203.0.113.11')).status).toBe(200);
    }, 30000);

    it('validar código: 10 por minuto; gravar senha: 5 por minuto', async () => {
      const verifyStatuses = [];
      for (let i = 0; i < 11; i++) verifyStatuses.push((await verify('nunca.existiu@reset.teste.com', '123456', '203.0.113.20')).status);
      expect(verifyStatuses.slice(0, 10).every((status) => status === 400)).toBe(true);
      expect(verifyStatuses[10]).toBe(429);

      const resetStatuses = [];
      for (let i = 0; i < 6; i++) resetStatuses.push((await reset('lixo', 'umasenhaboa', '203.0.113.21')).status);
      expect(resetStatuses).toEqual([400, 400, 400, 400, 400, 429]);
    }, 30000);
  });

  describe('tempo de resposta (CA-10)', () => {
    const average = async (calls: Array<() => Promise<unknown>>) => {
      const started = Date.now();
      for (const call of calls) await call();
      return (Date.now() - started) / calls.length;
    };

    it('pedir código: elegível e inexistente respondem com diferença média abaixo de 100 ms', async () => {
      const user = await createFixed('Timo Tempo');
      const existing = await average(Array.from({ length: 20 }, () => () => forgot(user.email)));
      const unknown = await average(Array.from({ length: 20 }, () => () => forgot('fantasma@reset.teste.com')));

      expect(Math.abs(existing - unknown)).toBeLessThan(100);
    }, 90000);

    it('validar código: conta real com código errado e conta inexistente, diferença média abaixo de 100 ms', async () => {
      const user = await createFixed('Tina Tempo');
      const code = await requestCode(user.email);
      const wrong = wrongCodeFor(code);
      const real = await average(Array.from({ length: 20 }, () => () => verify(user.email, wrong)));
      const unknown = await average(Array.from({ length: 20 }, () => () => verify('fantasma@reset.teste.com', wrong)));

      expect(Math.abs(real - unknown)).toBeLessThan(100);
    }, 90000);
  });

  describe('token de redefinição (CA-18 a CA-23, CA-55, CA-56, CA-57)', () => {
    const verifiedToken = async (email: string) => {
      const code = await requestCode(email);
      const res = await verify(email, code);
      expect(res.status).toBe(200);
      return res.body.resetToken as string;
    };
    const unchanged = async (email: string) => expect((await login(email)).status).toBe(201);

    it('o mesmo token usado de novo é recusado (CA-18)', async () => {
      const user = await createFixed('Uso Unico');
      const token = await verifiedToken(user.email);

      expect((await reset(token, 'SenhaNova#1')).status).toBe(200);
      const second = await reset(token, 'SenhaNova#2');

      expect(second.status).toBe(400);
      expect(second.body.message).toBe(EXPIRED);
      expect((await login(user.email, 'SenhaNova#1')).status).toBe(201);
    }, 30000);

    it('tokens vencidos, de outro segredo, sem escopo, sem codeId, do painel ou da agenda não trocam a senha (CA-19)', async () => {
      const user = await createFixed('Token Tosco');
      const claims = { sub: user.id, codeId: '1679091c-5a88-4faf-a9cc-3d9b6a0b8d11', scope: 'password-reset' };
      const now = Math.floor(Date.now() / 1000);
      const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
      const withSecret = (payload: object, secret: string, options: object = { expiresIn: '10m' }) => jwt.sign(payload, { secret, ...options });
      const tokens: Record<string, string> = {
        // Sem o expiresIn padrão do módulo, para o exp do payload valer
        vencido: new JwtService({}).sign({ ...claims, iat: now - 700, exp: now - 100 }, { secret: `${SECRET}:password-reset` }),
        outroSegredo: withSecret(claims, 'outro-segredo-qualquer-de-32-caracteres!!'),
        changeme: withSecret(claims, 'changeme:password-reset'),
        semScope: withSecret({ sub: claims.sub, codeId: claims.codeId }, `${SECRET}:password-reset`),
        scopeErrado: withSecret({ ...claims, scope: 'schedule' }, `${SECRET}:password-reset`),
        semCodeId: withSecret({ sub: claims.sub, scope: 'password-reset' }, `${SECRET}:password-reset`),
        painel: await tokenOf(user.email),
        agenda: withSecret({ sub: user.id, organizationId: orgId, scope: 'schedule', codeId: claims.codeId }, `${SECRET}:schedule`),
        algNone: `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ ...claims, iat: now, exp: now + 600 })}.`,
      };

      for (const [name, token] of Object.entries(tokens)) {
        const res = await reset(token, 'SenhaNova#1');
        expect({ name, status: res.status, message: res.body.message }).toEqual({ name, status: 400, message: EXPIRED });
      }
      await unchanged(user.email);
    }, 40000);

    it('senha com 7 caracteres, 129 caracteres ou corpo de 10 KB é recusada na borda (CA-20)', async () => {
      const user = await createFixed('Senha Sete');
      const token = await verifiedToken(user.email);

      const short = await reset(token, '1234567');
      expect(short.status).toBe(400);
      expect(short.body.message).toEqual(['A senha deve ter no mínimo 8 caracteres.']);
      for (const password of ['a'.repeat(129), 'a'.repeat(10 * 1024)]) {
        const long = await reset(token, password);
        expect(long.status).toBe(400);
        expect(long.body.message).toEqual(['A senha deve ter no máximo 128 caracteres.']);
      }
      // O token continua valendo: nada foi consumido pela validação
      expect((await reset(token, '12345678')).status).toBe(200);
    }, 40000);

    it('token do código A é recusado depois de pedir o código B (CA-21)', async () => {
      const user = await createFixed('Ana Antiga');
      const tokenA = await verifiedToken(user.email);
      await requestCode(user.email);

      const res = await reset(tokenA, 'SenhaNova#1');

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(EXPIRED);
      await unchanged(user.email);
    }, 30000);

    it('quem virou volante entre validar o código e gravar a senha não troca a senha (CA-23)', async () => {
      const user = await createFixed('Vera Virou');
      const token = await verifiedToken(user.email);
      const hashOf = async () => (await userRepo.findOne({ where: { id: user.id }, select: { id: true, password: true } })).password;
      const before = await hashOf();
      await app.get(TeamMembershipService).assign({ birthDate: null, ...user }, floatingTeamId, adminId);

      const res = await reset(token, 'SenhaNova#1');

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(EXPIRED);
      // Agora é volante e o login o recusa; a prova de que a senha não mudou é o hash
      expect(await hashOf()).toBe(before);
    }, 30000);

    it('dois reset-password simultâneos com o mesmo token: uma troca só (CA-55)', async () => {
      const user = await createFixed('Duplo Reset');
      const token = await verifiedToken(user.email);

      const results = await Promise.all([reset(token, 'SenhaNova#1'), reset(token, 'SenhaNova#2')]);

      expect(results.map((res) => res.status).sort()).toEqual([200, 400]);
      const winner = results[0].status === 200 ? 'SenhaNova#1' : 'SenhaNova#2';
      expect((await login(user.email, winner)).status).toBe(201);
    }, 30000);

    it('token de redefinição e token da agenda não abrem rotas do painel (CA-56) e JWT sem iat também não (CA-57)', async () => {
      const user = await createFixed('Rota Restrita');
      const resetToken = await verifiedToken(user.email);
      const scheduleToken = jwt.sign({ sub: user.id, organizationId: orgId, scope: 'schedule' }, { secret: `${SECRET}:schedule`, expiresIn: '2h' });
      // Mesmo assinado com o segredo do painel, o claim scope barra (defesa em profundidade)
      const scopedWithPanelSecret = jwt.sign({ sub: user.id, organizationId: orgId, scope: 'schedule' });
      const noIat = jwt.sign({ sub: user.id, email: user.email, organizationId: orgId }, { noTimestamp: true });

      for (const token of [resetToken, scheduleToken, scopedWithPanelSecret, noIat]) {
        expect((await me(token)).status).toBe(401);
        expect((await request(server()).get('/pets').set(bearer(token))).status).toBe(401);
      }
    }, 30000);
  });

  describe('volante sem acesso (CA-39 a CA-42, CA-60, CA-61, CA-63)', () => {
    it('login do volante com a senha certa: 401 igual ao de senha errada, sem token; volante com acesso na matriz também (CA-39, CA-41, CA-62)', async () => {
      const volante = await createFloating('Vivi Login');
      const wrongPassword = await login(volante.email, 'errada');
      const rightPassword = await login(volante.email);

      expect(rightPassword.status).toBe(401);
      expect(rightPassword.body).toEqual(wrongPassword.body);
      expect(rightPassword.body.message).toBe('Credenciais inválidas.');
      expect(rightPassword.body).not.toHaveProperty('access_token');

      await app.get(TeamService).setPermissions(floatingTeamId, { PETS: 'EDIT' } as any);
      expect((await login(volante.email)).status).toBe(401);
      await app.get(TeamService).setPermissions(floatingTeamId, {});
    }, 30000);

    it('volante promovido para a equipe fixa entra normalmente (CA-40)', async () => {
      const volante = await createFloating('Paulo Promovido');
      const team = await joinTeam(app, volante, { PETS: 'VIEW' } as any);

      expect(team.id).not.toBe(floatingTeamId);
      const res = await login(volante.email);
      expect(res.status).toBe(201);
      expect((await me(res.body.access_token)).status).toBe(200);
    }, 20000);

    it('fixo movido para a equipe volante ou desativado cai na próxima requisição (CA-60)', async () => {
      const moved = await createFixed('Marcos Movido');
      const disabled = await createFixed('Dora Desativada');
      const movedToken = await tokenOf(moved.email);
      const disabledToken = await tokenOf(disabled.email);
      expect((await me(movedToken)).status).toBe(200);

      expect((await request(server()).patch(`/users/${moved.id}/team`).set(bearer(adminToken)).send({ teamId: floatingTeamId })).status).toBe(200);
      expect((await request(server()).patch(`/users/${disabled.id}/reject`).set(bearer(adminToken))).status).toBe(200);

      expect((await me(movedToken)).status).toBe(401);
      expect((await me(disabledToken)).status).toBe(401);
    }, 30000);

    it('reset pela tela Voluntários: volante dá 400 sem trocar a senha nem mandar e-mail; outra organização dá 404 (CA-42, CA-63)', async () => {
      const volante = await createFloating('Vitoria Reset');
      const foreign = await createUser('Outra Organizacao', {}, otherOrgId);
      const hashOf = async (id: string) => (await userRepo.findOne({ where: { id }, select: { id: true, password: true } })).password;
      const volanteHash = await hashOf(volante.id);
      const foreignHash = await hashOf(foreign.id);
      const sendReset = jest.spyOn(mail, 'sendPasswordResetEmail');

      const floatingRes = await request(server()).patch(`/users/${volante.id}/reset-password`).set(bearer(adminToken));
      const foreignRes = await request(server()).patch(`/users/${foreign.id}/reset-password`).set(bearer(adminToken));

      expect(floatingRes.status).toBe(400);
      expect(floatingRes.body.message).toBe('Voluntários volantes não usam o painel. Troque a equipe antes de redefinir a senha.');
      expect(foreignRes.status).toBe(404);
      expect(foreignRes.body.message).toBe('Usuário não encontrado.');
      expect(await hashOf(volante.id)).toBe(volanteHash);
      expect(await hashOf(foreign.id)).toBe(foreignHash);
      expect(sendReset).not.toHaveBeenCalled();
      sendReset.mockRestore();
    }, 20000);

    it('deploy: o SQL do RN-33 carimba só os volantes (CA-61)', async () => {
      const volante = await createFloating('Vasco Carimbo');
      const fixed = await createFixed('Fabio Carimbo');
      await dataSource.query(`UPDATE users SET password_changed_at = NULL WHERE id IN ($1, $2)`, [volante.id, fixed.id]);

      await dataSource.query(
        `UPDATE users u SET password_changed_at = now()
           FROM volunteers v JOIN teams t ON t.id = v.team_id
          WHERE v.user_id = u.id AND v.is_active = true AND t.system_key = 'FLOATING_VOLUNTEER'
          RETURNING u.id`,
      );

      const stamp = async (id: string) => (await dataSource.query('SELECT password_changed_at FROM users WHERE id = $1', [id]))[0].password_changed_at;
      expect(await stamp(volante.id)).toBeInstanceOf(Date);
      expect(await stamp(fixed.id)).toBeNull();
    });
  });

  describe('dados de usuário na API (CA-64, CA-65)', () => {
    const leaks = (body: unknown) => {
      const text = JSON.stringify(body);
      return ['"password"', '"confirmationCode"', '"passwordChangedAt"', '"passwordResetLockedUntil"'].filter((key) => text.includes(key));
    };

    it('nenhuma rota de /users, /auth/me nem o cadastro devolve hash, código de confirmação ou carimbos (CA-64)', async () => {
      const target = await createUser('Tiago Alvo', { isApproved: false, isConfirmed: false, confirmationCode: 'codigo-de-confirmacao' });
      const teamId = (await joinTeam(app, await createUser('Rafa Time'), { PETS: 'VIEW' } as any)).id;
      const auth = bearer(adminToken);
      const responses = [
        await request(server()).get(`/users/${target.id}`).set(auth),
        await request(server()).get('/users').set(auth),
        await request(server()).patch(`/users/${target.id}`).set(auth).send({ fullName: 'Tiago Alvo Editado' }),
        await request(server()).patch(`/users/${target.id}/activate`).set(auth),
        await request(server()).patch(`/users/${target.id}/approve`).set(auth).send({ teamId }),
        await request(server()).patch(`/users/${target.id}/team`).set(auth).send({ teamId }),
        await request(server()).patch(`/users/${target.id}/reset-password`).set(auth),
        await request(server()).patch(`/users/${target.id}/reject`).set(auth),
        await request(server()).get('/auth/me').set(auth),
        await request(server()).patch(`/users/confirm/codigo-de-confirmacao`),
      ];

      for (const res of responses) expect({ url: res.request.url, status: res.status, leaks: leaks(res.body) }).toEqual({ url: res.request.url, status: expect.any(Number), leaks: [] });
      expect(responses.slice(0, 9).every((res) => res.status === 200)).toBe(true);
      expect(responses[1].body.data.length).toBeGreaterThan(0);
      // A lista traz a chave da equipe: o front reconhece o volante por team.systemKey, não pelo nome
      const listed = await request(server()).get('/users?limit=100').set(auth);
      const volante = await createFloating('Lista Volante');
      const again = await request(server()).get('/users?limit=100').set(auth);
      expect(listed.body.data.every((user: any) => user.team === null || 'systemKey' in user.team)).toBe(true);
      expect(again.body.data.find((user: any) => user.id === volante.id).team).toEqual(expect.objectContaining({ systemKey: 'FLOATING_VOLUNTEER' }));
      // O código de confirmação foi gravado e a confirmação funcionou, só não volta na resposta
      expect(responses[9].status).toBe(200);
      expect(responses[9].body).toEqual(expect.objectContaining({ id: target.id, isConfirmed: true }));
    }, 40000);

    it('usuário de outra organização dá 404 em todas as rotas por id, e a lista traz só a própria organização (CA-65)', async () => {
      const mine = await createUser('Ninho Meu');
      const foreign = await createUser('Ninho Alheio', {}, otherOrgId);
      const auth = bearer(adminToken);
      const teamId = (await app.get(TeamService).ensureAdminTeam(orgId)).id;
      const calls = [
        request(server()).get(`/users/${foreign.id}`).set(auth),
        request(server()).patch(`/users/${foreign.id}`).set(auth).send({ fullName: 'Hackeado Por Fora' }),
        request(server()).patch(`/users/${foreign.id}/activate`).set(auth),
        request(server()).patch(`/users/${foreign.id}/approve`).set(auth).send({ teamId }),
        request(server()).patch(`/users/${foreign.id}/reject`).set(auth),
        request(server()).patch(`/users/${foreign.id}/team`).set(auth).send({ teamId }),
      ];

      for (const res of await Promise.all(calls)) {
        expect(res.status).toBe(404);
        expect(res.body.message).toBe('Usuário não encontrado.');
      }
      expect((await userRepo.findOne({ where: { id: foreign.id } })).fullName).toBe('Ninho Alheio');
      // O inverso também: o admin da outra organização não enxerga o nosso
      expect((await request(server()).get(`/users/${mine.id}`).set(bearer(otherAdminToken))).status).toBe(404);

      const list = await request(server()).get('/users?limit=100').set(auth);
      expect(list.status).toBe(200);
      expect(list.body.data.length).toBeGreaterThan(0);
      expect(list.body.data.every((user: User) => user.organizationId === orgId)).toBe(true);
      expect(list.body.data.map((user: User) => user.id)).not.toContain(foreign.id);
      // O próprio usuário continua acessível
      expect((await request(server()).get(`/users/${mine.id}`).set(auth)).status).toBe(200);
    }, 30000);
  });

  describe('log de segurança (CA-68, CA-70)', () => {
    it('os eventos aparecem e nenhum log traz código, token, senha nem e-mail de conta não encontrada', async () => {
      const user = await createFixed('Lara Log');
      const code = await requestCode(user.email);
      await verify(user.email, wrongCodeFor(code));
      const verified = await verify(user.email, code);
      const token = verified.body.resetToken;
      expect((await reset(token, 'SenhaDoLog#2026')).status).toBe(200);
      await forgot('conta.inexistente.log@reset.teste.com');
      await sleep(300);

      const events = logs.filter((line) => line.startsWith('{"event":"password_reset.')).map((line) => JSON.parse(line).event);
      for (const event of ['requested', 'blocked', 'verify_failed', 'locked', 'completed']) expect(events).toContain(`password_reset.${event}`);

      const all = logs.join('\n');
      for (const secret of [code, token, 'SenhaDoLog#2026', 'conta.inexistente.log@reset.teste.com']) expect(all).not.toContain(secret);
      expect(logs.some((line) => line.includes('"event":"password_reset.requested"') && line.includes('"eligible":false'))).toBe(true);
    }, 30000);
  });
});
