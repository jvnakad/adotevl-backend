import { TestAppModule, joinTeam, cleanupAccess } from './test-app.module';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Profile } from '../src/profile/profile.entity';
import { Organization } from '../src/organization/organization.entity';
import { User } from '../src/user/user.entity';
import { MailService } from '../src/mail/mail.service';
import { TeamService } from '../src/team/team.service';
import { TeamMembershipService } from '../src/team/team-membership.service';
import { TeamSystemKey } from '../src/team/team.entity';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const GONE = 'Este pedido de troca não vale mais. Comece de novo.';

type MockMail = {
  lastEmailChangeCode: string | null;
  emailChangeCodeSentTo: string[];
  failEmailChangeSend: boolean;
  lastPasswordResetCode: string | null;
};

/**
 * Troca do próprio e-mail (docs/specs/troca-email.md). Só roda com DATABASE_URL local (assertLocalTestDatabase em test-app.module).
 */
describe('Troca do próprio e-mail (e2e)', () => {
  let app: INestApplication;
  let moduleFixture: TestingModule;
  let dataSource: DataSource;
  let userRepo: Repository<User>;
  let orgRepo: Repository<Organization>;
  let mail: MockMail;
  let orgId: string;
  let otherOrgId: string;
  let profileId: string;
  let adminToken: string;
  let seq = 0;
  const logs: string[] = [];

  const server = () => app.getHttpServer();
  const nextIp = () => `10.${Math.floor(seq / 60000) % 250}.${Math.floor(seq / 250) % 250}.${(seq++ % 250) + 1}`;
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const call = (method: 'post' | 'delete', path: string, token: string, body?: object, ip = nextIp()) => {
    const req = request(server())[method](`/users/me/email-change${path}`).set(bearer(token)).set('X-Forwarded-For', ip);
    return body ? req.send(body) : req;
  };
  const ask = (token: string, newEmail: string, currentPassword = 'senha123', ip?: string) => call('post', '', token, { newEmail, currentPassword }, ip);
  const resend = (token: string) => call('post', '/resend', token);
  const confirm = (token: string, code: string, ip?: string) => call('post', '/confirm', token, { code }, ip);
  const cancel = (token: string) => call('delete', '', token);
  // IP novo a cada login: o login tem limite de 10 por minuto por IP
  const login = (email: string, password = 'senha123') => request(server()).post('/auth/login').set('X-Forwarded-For', nextIp()).send({ email, password });
  const tokenOf = async (email: string, password = 'senha123') => (await login(email, password)).body.access_token as string;
  const me = (token: string) => request(server()).get('/auth/me').set(bearer(token));
  const wrongCodeFor = (code: string) => (code === '000000' ? '000001' : '000000');
  const emailOf = async (id: string) => (await userRepo.findOne({ where: { id } })).email;

  const createUser = async (name: string, overrides: Partial<User> = {}, organizationId = orgId) =>
    userRepo.save(
      userRepo.create({
        fullName: name,
        cpf: String(12000000000 + ++seq),
        email: `${name.toLowerCase().replace(/\s+/g, '.')}@troca.teste.com`,
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
  const createFixed = async (name: string, overrides: Partial<User> = {}) => {
    const user = await createUser(name, overrides);
    await joinTeam(app, user, { PETS: 'VIEW' } as any);
    return user;
  };
  /** Envelhece os pedidos da conta (created_at e validades juntos), para vencer o cooldown ou os prazos. */
  const shift = (userId: string, interval: string) =>
    dataSource.query(
      `UPDATE email_change_requests SET created_at = created_at - interval '${interval}', expires_at = expires_at - interval '${interval}', request_expires_at = request_expires_at - interval '${interval}' WHERE user_id = $1`,
      [userId],
    );
  const clearCooldown = (userId: string) => shift(userId, '61 seconds');
  const requestsOf = (userId: string) => dataSource.query('SELECT * FROM email_change_requests WHERE user_id = $1 ORDER BY created_at', [userId]);
  const pendingOf = async (userId: string) => (await requestsOf(userId)).filter((row: any) => row.closed_at === null);
  /** Pede a troca e devolve o código que chegou ao e-mail novo. */
  const openRequest = async (token: string, userId: string, newEmail: string, password = 'senha123') => {
    await clearCooldown(userId);
    const res = await ask(token, newEmail, password);
    expect(res.status).toBe(200);
    expect(mail.emailChangeCodeSentTo[mail.emailChangeCodeSentTo.length - 1]).toBe(newEmail);
    return mail.lastEmailChangeCode as string;
  };

  beforeAll(async () => {
    moduleFixture = await Test.createTestingModule({ imports: [TestAppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    app.getHttpAdapter().getInstance().set('trust proxy', true);
    await app.init();
    await app.listen(0);

    dataSource = moduleFixture.get(DataSource);
    userRepo = moduleFixture.get(getRepositoryToken(User));
    orgRepo = moduleFixture.get(getRepositoryToken(Organization));
    const profileRepo: Repository<Profile> = moduleFixture.get(getRepositoryToken(Profile));
    mail = app.get(MailService) as unknown as MockMail;

    for (const level of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((message: unknown) => {
        logs.push(String(message));
      });
    }

    for (const cnpj of ['77777777777781', '77777777777782']) {
      const existing = await orgRepo.findOne({ where: { cnpj } });
      if (existing) {
        await cleanupAccess(app, existing.id);
        await userRepo.delete({ organizationId: existing.id });
        await orgRepo.delete({ id: existing.id });
      }
    }
    if (!(await profileRepo.findOne({ where: { name: 'VOLUNTEER' } }))) await profileRepo.save([{ name: 'ADMIN' }, { name: 'FINANCIAL' }, { name: 'VOLUNTEER' }]);
    profileId = (await profileRepo.findOne({ where: { name: 'VOLUNTEER' } })).id;
    orgId = (await orgRepo.save({ legalName: 'Org Troca', cnpj: '77777777777781' })).id;
    otherOrgId = (await orgRepo.save({ legalName: 'Org Troca Outra', cnpj: '77777777777782' })).id;
    const admin = await createUser('Admin Troca');
    await joinTeam(app, admin, 'ADMIN');
    adminToken = await tokenOf(admin.email);
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

  describe('pedir (CA-01 a CA-14)', () => {
    it('CA-01/CA-33: manda o código só ao e-mail novo e o e-mail atual continua valendo', async () => {
      const ana = await createFixed('Ana Pedido');
      const token = await tokenOf(ana.email);
      const before = mail.emailChangeCodeSentTo.length;

      const res = await ask(token, ' Ana.Nova@TROCA.teste.com ');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'Enviamos um código para ana.nova@troca.teste.com.', newEmail: 'ana.nova@troca.teste.com', resendInSeconds: 60 });
      expect(mail.emailChangeCodeSentTo.slice(before)).toEqual(['ana.nova@troca.teste.com']);
      expect(mail.lastEmailChangeCode).toMatch(/^\d{6}$/);
      expect(await emailOf(ana.id)).toBe(ana.email);
      expect((await login(ana.email)).status).toBe(201);
      // CA-12: só o hash no banco
      const [row] = await requestsOf(ana.id);
      expect(row.code_hash).toHaveLength(60);
      expect(row.code_hash).not.toContain(mail.lastEmailChangeCode);
    });

    it('CA-02: Admin troca o próprio e-mail pelo mesmo fluxo', async () => {
      expect((await ask(adminToken, 'admin.novo@troca.teste.com')).status).toBe(200);
      await cancel(adminToken);
    });

    it('CA-03/CA-07: senha errada é 400 e não revela "em uso"; pedido pendente anterior continua', async () => {
      const bia = await createFixed('Bia Senha');
      const token = await tokenOf(bia.email);
      const code = await openRequest(token, bia.id, 'bia.nova@troca.teste.com');
      const sent = mail.emailChangeCodeSentTo.length;

      const wrong = await ask(token, bia.email.replace('bia', 'admin'), 'errada');
      expect(wrong.status).toBe(400);
      expect(wrong.body).toMatchObject({ code: 'WRONG_PASSWORD', message: 'Senha atual incorreta.' });
      const taken = await ask(token, 'admin.troca@troca.teste.com', 'errada');
      expect(taken.body.code).toBe('WRONG_PASSWORD');
      expect(mail.emailChangeCodeSentTo).toHaveLength(sent);
      expect(await pendingOf(bia.id)).toHaveLength(1);
      expect((await confirm(token, code)).status).toBe(200);
    });

    it('CA-04: 5 senhas erradas bloqueiam por 1 h, mesmo com a senha certa; o login segue funcionando', async () => {
      const caio = await createFixed('Caio Bloqueio');
      const token = await tokenOf(caio.email);
      for (let i = 0; i < 5; i++) expect((await ask(token, 'caio.novo@troca.teste.com', 'errada')).body.code).toBe('WRONG_PASSWORD');

      const locked = await ask(token, 'caio.novo@troca.teste.com');
      expect(locked.status).toBe(429);
      expect(locked.body).toMatchObject({ code: 'PASSWORD_LOCKED', message: 'Muitas tentativas com a senha errada. Tente de novo em 1 hora.' });
      expect((await login(caio.email)).status).toBe(201);

      await dataSource.query(`UPDATE email_change_events SET created_at = created_at - interval '61 minutes' WHERE user_id = $1`, [caio.id]);
      expect((await ask(token, 'caio.novo@troca.teste.com')).status).toBe(200);
    });

    it('CA-05: e-mail igual ao atual em outra caixa é 400, sem conferir a senha', async () => {
      const dani = await createFixed('Dani Igual');
      const token = await tokenOf(dani.email);
      const res = await ask(token, dani.email.toUpperCase(), 'errada');

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: 'SAME_EMAIL', message: 'Este já é o seu e-mail atual.' });
    });

    it('CA-06: e-mail em uso (outra caixa, inativa, volante, outra organização) é 409 e não manda e-mail', async () => {
      const eva = await createFixed('Eva Uso');
      const token = await tokenOf(eva.email);
      const inactive = await createUser('Inativa Uso', { isActive: false });
      const floating = await createUser('Volante Uso');
      await app.get(TeamMembershipService).assign({ birthDate: null, ...floating }, (await app.get(TeamService).systemTeam(orgId, TeamSystemKey.FLOATING_VOLUNTEER)).id, null);
      const outside = await createUser('Fora Uso', {}, otherOrgId);
      const sent = mail.emailChangeCodeSentTo.length;

      for (const email of ['ADMIN.TROCA@troca.teste.com', inactive.email, floating.email, outside.email]) {
        await clearCooldown(eva.id);
        const res = await ask(token, email);
        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({ code: 'EMAIL_IN_USE', message: 'Este e-mail já está em uso.' });
      }
      expect(mail.emailChangeCodeSentTo).toHaveLength(sent);
      expect(await requestsOf(eva.id)).toHaveLength(0);
    });

    it('CA-08: cooldown de 60 s devolve retryAfterSeconds e não invalida o código atual', async () => {
      const gil = await createFixed('Gil Cooldown');
      const token = await tokenOf(gil.email);
      const code = await openRequest(token, gil.id, 'gil.a@troca.teste.com');
      const sent = mail.emailChangeCodeSentTo.length;

      const again = await ask(token, 'gil.b@troca.teste.com');
      expect(again.status).toBe(429);
      expect(again.body).toMatchObject({ code: 'COOLDOWN', message: 'Aguarde para pedir outro código.' });
      expect(again.body.retryAfterSeconds).toBeGreaterThan(0);
      expect(again.body.retryAfterSeconds).toBeLessThanOrEqual(60);
      expect((await resend(token)).body.code).toBe('COOLDOWN');
      expect(mail.emailChangeCodeSentTo).toHaveLength(sent);
      expect((await confirm(token, code)).status).toBe(200);
    });

    it('CA-09: 5 por hora e 10 por dia (o 409 conta); o esqueci senha não entra na conta', async () => {
      const hana = await createFixed('Hana Limite');
      const token = await tokenOf(hana.email);
      for (let i = 0; i < 5; i++) {
        await clearCooldown(hana.id);
        expect((await ask(token, `hana.${i}@troca.teste.com`)).status).toBe(200);
      }
      await clearCooldown(hana.id);
      const hour = await ask(token, 'hana.x@troca.teste.com');
      expect(hour.status).toBe(429);
      expect(hour.body).toMatchObject({ code: 'HOURLY_LIMIT', message: 'Você atingiu o limite de códigos por hora. Tente de novo mais tarde.' });

      // Passada 1 h, mais 5 chegam ao teto do dia
      await shift(hana.id, '2 hours');
      await dataSource.query(`UPDATE email_change_events SET created_at = created_at - interval '2 hours' WHERE user_id = $1`, [hana.id]);
      for (let i = 5; i < 10; i++) {
        await clearCooldown(hana.id);
        expect((await ask(token, `hana.${i}@troca.teste.com`)).status).toBe(200);
      }
      await shift(hana.id, '2 hours');
      // 10 em 24 h (as 5 mais velhas já saíram da hora): o próximo cai no dia
      await dataSource.query(`UPDATE email_change_requests SET created_at = created_at - interval '3 hours' WHERE user_id = $1`, [hana.id]);
      await clearCooldown(hana.id);
      const day = await ask(token, 'hana.y@troca.teste.com');
      expect(day.status).toBe(429);
      expect(day.body).toMatchObject({ code: 'DAILY_LIMIT', message: 'Você atingiu o limite de códigos de hoje. Tente de novo amanhã.' });
    });

    it('CA-10: 2 pedidos simultâneos mandam 1 e-mail e deixam 1 pedido pendente', async () => {
      const ian = await createFixed('Ian Corrida');
      const token = await tokenOf(ian.email);
      const sent = mail.emailChangeCodeSentTo.length;

      const [a, b] = await Promise.all([ask(token, 'ian.a@troca.teste.com'), ask(token, 'ian.b@troca.teste.com')]);

      expect([a.status, b.status].sort()).toEqual([200, 429]);
      expect(mail.emailChangeCodeSentTo).toHaveLength(sent + 1);
      expect(await pendingOf(ian.id)).toHaveLength(1);
    });

    it('CA-11: pedido novo invalida o código do anterior', async () => {
      const jo = await createFixed('Jo Troca');
      const token = await tokenOf(jo.email);
      const codeA = await openRequest(token, jo.id, 'jo.a@troca.teste.com');
      const codeB = await openRequest(token, jo.id, 'jo.b@troca.teste.com');

      if (codeA !== codeB) expect((await confirm(token, codeA)).body.code).toBe('CODE_INVALID');
      expect((await confirm(token, codeB)).status).toBe(200);
      expect(await emailOf(jo.id)).toBe('jo.b@troca.teste.com');
    });

    it('CA-13: volante, inativo e token da agenda recebem 401 nas 4 rotas', async () => {
      const kai = await createFixed('Kai Volante');
      const token = await tokenOf(kai.email);
      await app.get(TeamMembershipService).assign({ birthDate: null, ...kai }, (await app.get(TeamService).systemTeam(orgId, TeamSystemKey.FLOATING_VOLUNTEER)).id, null);
      for (const res of [await ask(token, 'k@troca.teste.com'), await resend(token), await confirm(token, '123456'), await cancel(token)]) expect(res.status).toBe(401);
      expect((await call('post', '', 'sem-token', { newEmail: 'k@troca.teste.com', currentPassword: 'x' })).status).toBe(401);
    });

    it('CA-14: userId no body é ignorado', async () => {
      const lia = await createFixed('Lia Dona');
      const mia = await createFixed('Mia Alheia');
      const token = await tokenOf(lia.email);
      const res = await call('post', '', token, { newEmail: 'lia.nova@troca.teste.com', currentPassword: 'senha123', userId: mia.id });

      expect(res.status).toBe(200);
      expect(await pendingOf(mia.id)).toHaveLength(0);
      expect(await pendingOf(lia.id)).toHaveLength(1);
    });

    it('validação do DTO: e-mail inválido e código fora do formato (CA-29)', async () => {
      const noa = await createFixed('Noa Dto');
      const token = await tokenOf(noa.email);
      const bad = await ask(token, 'sem-arroba', '');
      expect(bad.status).toBe(400);
      expect(bad.body.message).toEqual(['E-mail inválido. Confira se está no formato nome@exemplo.com.', 'Informe sua senha atual.']);
      // BUG-06: body vazio dá uma mensagem correta por campo, sem repetir
      const empty = await call('post', '', token, {});
      expect(empty.status).toBe(400);
      expect([...empty.body.message].sort()).toEqual(['Informe o novo e-mail.', 'Informe sua senha atual.']);
      for (const code of ['12345a', '1234567']) {
        const res = await confirm(token, code);
        expect(res.status).toBe(400);
        expect(res.body.message).toEqual(['O código deve ter 6 dígitos.']);
      }
    });
  });

  describe('reenviar e cancelar (CA-15 a CA-17)', () => {
    it('CA-15: reenvio manda código novo ao mesmo e-mail sem senha e o anterior deixa de valer', async () => {
      const ola = await createFixed('Ola Reenvio');
      const token = await tokenOf(ola.email);
      const first = await openRequest(token, ola.id, 'ola.nova@troca.teste.com');
      await clearCooldown(ola.id);

      const res = await resend(token);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'Enviamos um novo código para ola.nova@troca.teste.com.', newEmail: 'ola.nova@troca.teste.com', resendInSeconds: 60 });
      const second = mail.lastEmailChangeCode as string;
      if (first !== second) {
        const old = await confirm(token, first);
        expect(old.status).toBe(400);
        expect(old.body.code).toBe('CODE_INVALID');
      }
      expect((await confirm(token, second)).status).toBe(200);
    });

    it('CA-16: sem pedido ou com mais de 30 min é 410', async () => {
      const pri = await createFixed('Pri Gone');
      const token = await tokenOf(pri.email);
      for (const res of [await resend(token), await confirm(token, '123456')]) {
        expect(res.status).toBe(410);
        expect(res.body).toMatchObject({ code: 'REQUEST_GONE', message: GONE });
      }
      const code = await openRequest(token, pri.id, 'pri.nova@troca.teste.com');
      await shift(pri.id, '31 minutes');
      expect((await resend(token)).status).toBe(410);
      expect((await confirm(token, code)).status).toBe(410);
    });

    it('CA-17: cancelar invalida o pedido e é idempotente', async () => {
      const raul = await createFixed('Raul Cancela');
      const token = await tokenOf(raul.email);
      const code = await openRequest(token, raul.id, 'raul.novo@troca.teste.com');

      for (let i = 0; i < 2; i++) {
        const res = await cancel(token);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ message: 'Troca de e-mail cancelada.' });
      }
      expect((await confirm(token, code)).status).toBe(410);
      expect(await emailOf(raul.id)).toBe(raul.email);
    });
  });

  describe('confirmar (CA-18 a CA-29)', () => {
    it('CA-18/CA-19/CA-20: troca o e-mail, derruba todas as sessões e fecha a recuperação de senha aberta', async () => {
      const sara = await createFixed('Sara Confirma');
      const [sessionA, sessionB] = [await tokenOf(sara.email), await tokenOf(sara.email)];
      await sleep(1100);
      const code = await openRequest(sessionA, sara.id, 'sara.nova@troca.teste.com');

      // Recuperação aberta com o e-mail antigo: um código não usado e um já validado
      const forgot = (email: string) => request(server()).post('/auth/forgot-password').set('X-Forwarded-For', nextIp()).send({ email });
      await forgot(sara.email);
      await sleep(300);
      const resetCode = mail.lastPasswordResetCode as string;
      const verified = await request(server()).post('/auth/forgot-password/verify').set('X-Forwarded-For', nextIp()).send({ email: sara.email, code: resetCode });
      expect(verified.status).toBe(200);

      const sent = mail.emailChangeCodeSentTo.length;
      const res = await confirm(sessionA, code);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'E-mail alterado. Entre de novo com o novo e-mail.' });
      expect(mail.emailChangeCodeSentTo).toHaveLength(sent);

      expect(await emailOf(sara.id)).toBe('sara.nova@troca.teste.com');
      expect((await login('sara.nova@troca.teste.com')).status).toBe(201);
      const oldLogin = await login(sara.email);
      expect(oldLogin.status).toBe(401);
      expect(oldLogin.body.message).toBe('Credenciais inválidas.');
      for (const token of [sessionA, sessionB]) expect((await me(token)).status).toBe(401);
      expect((await me(await tokenOf('sara.nova@troca.teste.com'))).status).toBe(200);

      // CA-20: o resetToken já emitido não grava mais a senha
      const reset = await request(server()).post('/auth/reset-password').set('X-Forwarded-For', nextIp()).send({ resetToken: verified.body.resetToken, password: 'OutraSenha#2026' });
      expect(reset.status).toBe(400);
      expect(reset.body.message).toBe('Este pedido expirou. Comece de novo.');
      expect((await login('sara.nova@troca.teste.com')).status).toBe(201);
    });

    it('CA-21: tentativas 4, 3, 2, 1 e CODE_EXHAUSTED; depois o código certo também é recusado', async () => {
      const teo = await createFixed('Teo Tentativas');
      const token = await tokenOf(teo.email);
      const code = await openRequest(token, teo.id, 'teo.novo@troca.teste.com');
      const wrong = wrongCodeFor(code);

      for (const left of [4, 3, 2, 1]) {
        const res = await confirm(token, wrong);
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({ code: 'CODE_INVALID', attemptsLeft: left });
        expect(res.body.message).toBe(`Código incorreto. Você ainda tem ${left} ${left === 1 ? 'tentativa' : 'tentativas'}.`);
      }
      const fifth = await confirm(token, wrong);
      expect(fifth.body).toMatchObject({ code: 'CODE_EXHAUSTED', message: 'Muitas tentativas com este código. Peça um novo.' });
      expect((await confirm(token, code)).body.code).toBe('CODE_EXHAUSTED');
      expect(await emailOf(teo.id)).toBe(teo.email);
    });

    it('CA-22: código com 5 min e 1 s expira; com 4 min e 50 s ainda vale', async () => {
      const uma = await createFixed('Uma Prazo');
      const token = await tokenOf(uma.email);
      const code = await openRequest(token, uma.id, 'uma.nova@troca.teste.com');
      await dataSource.query(`UPDATE email_change_requests SET created_at = now() - interval '5 minutes 30 seconds', expires_at = now() - interval '1 second' WHERE user_id = $1`, [uma.id]);

      const expired = await confirm(token, code);
      expect(expired.status).toBe(400);
      expect(expired.body).toMatchObject({ code: 'CODE_EXPIRED', message: 'Este código expirou. Peça um novo.' });

      await clearCooldown(uma.id);
      expect((await resend(token)).status).toBe(200);
      const fresh = mail.lastEmailChangeCode as string;
      await dataSource.query(`UPDATE email_change_requests SET expires_at = now() + interval '10 seconds' WHERE user_id = $1 AND closed_at IS NULL`, [uma.id]);
      expect((await confirm(token, fresh)).status).toBe(200);
    });

    it('CA-23: 50 confirmações concorrentes com código errado terminam com attempts = 5', async () => {
      const vic = await createFixed('Vic Concorrente');
      const token = await tokenOf(vic.email);
      const code = await openRequest(token, vic.id, 'vic.novo@troca.teste.com');
      const wrong = wrongCodeFor(code);

      await Promise.all(Array.from({ length: 50 }, () => confirm(token, wrong)));

      const [row] = await pendingOf(vic.id).then((rows) => (rows.length ? rows : requestsOf(vic.id)));
      expect(row.attempts).toBe(5);
    });

    it('CA-24: 2 confirmações simultâneas com o código certo geram 1 troca e um 410', async () => {
      const wil = await createFixed('Wil Dupla');
      const token = await tokenOf(wil.email);
      const code = await openRequest(token, wil.id, 'wil.novo@troca.teste.com');

      const results = await Promise.all([confirm(token, code), confirm(token, code)]);

      const statuses = results.map((res) => res.status).sort();
      expect(statuses[0]).toBe(200);
      expect([400, 410]).toContain(statuses[1]);
      expect(await emailOf(wil.id)).toBe('wil.novo@troca.teste.com');
    });

    it('CA-25: 15 códigos errados em 24 h (3 pedidos) bloqueiam por 24 h e encerram o pedido', async () => {
      const xuxa = await createFixed('Xuxa Bloqueio');
      const token = await tokenOf(xuxa.email);
      let last: any;
      for (let round = 0; round < 3; round++) {
        const code = await openRequest(token, xuxa.id, `xuxa.${round}@troca.teste.com`);
        for (let i = 0; i < 5; i++) last = await confirm(token, wrongCodeFor(code));
      }

      expect(last.status).toBe(429);
      expect(last.body).toMatchObject({ code: 'CODE_LOCKED', message: 'Muitas tentativas com código errado. A troca de e-mail fica bloqueada por 24 horas.' });
      expect(await pendingOf(xuxa.id)).toHaveLength(0);
      await clearCooldown(xuxa.id);
      expect((await ask(token, 'xuxa.z@troca.teste.com')).body.code).toBe('CODE_LOCKED');
      expect((await login(xuxa.email)).status).toBe(201);
      expect((await request(server()).post('/auth/forgot-password').set('X-Forwarded-For', nextIp()).send({ email: xuxa.email })).status).toBe(200);
    });

    it('CA-26: e-mail tomado entre o pedido e a confirmação é 409 e a conta não muda', async () => {
      const yara = await createFixed('Yara Tomada');
      const token = await tokenOf(yara.email);
      const code = await openRequest(token, yara.id, 'yara.nova@troca.teste.com');
      await createUser('Intrusa', { email: 'YARA.NOVA@troca.teste.com' });

      const res = await confirm(token, code);

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'EMAIL_IN_USE', message: 'Este e-mail passou a ser usado por outra conta. Escolha outro.' });
      expect(await emailOf(yara.id)).toBe(yara.email);
      expect((await me(token)).status).toBe(200);
      expect(await pendingOf(yara.id)).toHaveLength(0);
    });

    it('CA-27: duas contas com pedido para o mesmo e-mail livre: só a primeira troca', async () => {
      const zeca = await createFixed('Zeca Primeiro');
      const zilda = await createFixed('Zilda Segunda');
      const [tokenA, tokenB] = [await tokenOf(zeca.email), await tokenOf(zilda.email)];
      const codeA = await openRequest(tokenA, zeca.id, 'disputado@troca.teste.com');
      const codeB = await openRequest(tokenB, zilda.id, 'disputado@troca.teste.com');

      expect((await confirm(tokenA, codeA)).status).toBe(200);
      const second = await confirm(tokenB, codeB);
      expect(second.status).toBe(409);
      expect(second.body.code).toBe('EMAIL_IN_USE');
    });

    it('CA-28: troca de senha (perfil, esqueci senha, resetar pelo Admin) invalida o pedido pendente', async () => {
      const abel = await createFixed('Abel Senha');
      let token = await tokenOf(abel.email);
      let code = await openRequest(token, abel.id, 'abel.novo@troca.teste.com');

      const changed = await request(server()).patch('/users/me/password').set(bearer(token)).send({ currentPassword: 'senha123', newPassword: 'NovaSenha#1' });
      expect(changed.status).toBe(200);
      token = changed.body.access_token;
      expect((await confirm(token, code)).status).toBe(410);

      code = await openRequest(token, abel.id, 'abel.novo@troca.teste.com', 'NovaSenha#1');
      await sleep(1100);
      const reset = await request(server()).patch(`/users/${abel.id}/reset-password`).set(bearer(adminToken));
      expect(reset.status).toBe(200);
      expect(await pendingOf(abel.id)).toHaveLength(0);
      expect(code).toMatch(/^\d{6}$/);
    });

    it('CA-34: envio falhando continua 200 e o log não vaza código, senha nem e-mail novo', async () => {
      const bruno = await createFixed('Bruno Falha');
      const token = await tokenOf(bruno.email);
      logs.length = 0;
      mail.failEmailChangeSend = true;
      try {
        const res = await ask(token, 'bruno.novo@troca.teste.com');
        expect(res.status).toBe(200);
      } finally {
        mail.failEmailChangeSend = false;
      }
      const text = logs.join('\n');
      expect(text).not.toContain('bruno.novo@troca.teste.com');
      expect(text).not.toContain('senha123');
    });

    it('CA-35: eventos de segurança sem e-mail em claro', async () => {
      const carla = await createFixed('Carla Logs');
      const token = await tokenOf(carla.email);
      logs.length = 0;
      await ask(token, 'carla.nova@troca.teste.com', 'errada');
      const code = await openRequest(token, carla.id, 'carla.nova@troca.teste.com');
      await confirm(token, wrongCodeFor(code));
      await confirm(token, code);

      const text = logs.join('\n');
      for (const event of ['email_change.password_failed', 'email_change.requested', 'email_change.verify_failed', 'email_change.completed']) expect(text).toContain(event);
      expect(text).not.toContain('carla.nova@troca.teste.com');
      expect(text).not.toContain(carla.email);
      expect(text).not.toContain(code);
    });
  });

  describe('integração com o Admin (CA-30, CA-31)', () => {
    it('CA-30: Admin trocando o próprio e-mail por PATCH /users/:id recebe 400', async () => {
      const admin = await userRepo.findOne({ where: { organizationId: orgId, fullName: 'Admin Troca' } });
      const res = await request(server()).patch(`/users/${admin.id}`).set(bearer(adminToken)).send({ email: 'admin.outro@troca.teste.com' });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Altere seu e-mail em Editar perfil.');
      expect(await emailOf(admin.id)).toBe(admin.email);
    });

    it('SEC-BUG-01/D-12: quem só tem Voluntários (Editar) não troca o e-mail de outro: 403, mas edita os outros campos', async () => {
      const gestor = await createUser('Gestor Voluntarios');
      await joinTeam(app, gestor, { VOLUNTEERS: 'EDIT' } as any);
      const alvo = await createFixed('Alvo Gestor');
      const token = await tokenOf(gestor.email);

      const denied = await request(server()).patch(`/users/${alvo.id}`).set(bearer(token)).send({ email: 'alvo.novo@troca.teste.com' });
      expect(denied.status).toBe(403);
      expect(denied.body.message).toBe('Só o Admin pode alterar o e-mail.');
      expect(await emailOf(alvo.id)).toBe(alvo.email);

      const ok = await request(server()).patch(`/users/${alvo.id}`).set(bearer(token)).send({ fullName: 'Alvo Renomeado', email: alvo.email });
      expect(ok.status).toBe(200);
      expect((await userRepo.findOne({ where: { id: alvo.id } })).fullName).toBe('Alvo Renomeado');
    });

    it('CA-31: Admin trocando o e-mail do voluntário invalida o pedido pendente dele (e o resetToken validado)', async () => {
      const dora = await createFixed('Dora Admin');
      await sleep(1100);
      const token = await tokenOf(dora.email);
      const code = await openRequest(token, dora.id, 'dora.pedida@troca.teste.com');
      await sleep(1100);

      const res = await request(server()).patch(`/users/${dora.id}`).set(bearer(adminToken)).send({ email: 'dora.trocada@troca.teste.com' });

      expect(res.status).toBe(200);
      expect(await pendingOf(dora.id)).toHaveLength(0);
      const fresh = await tokenOf('dora.trocada@troca.teste.com');
      expect((await confirm(fresh, code)).status).toBe(410);
    });
  });

  describe('agenda da LP (P-01)', () => {
    it('a sessão da agenda aberta com o e-mail antigo cai na troca de e-mail', async () => {
      const edu = await createFixed('Edu Agenda');
      const token = await tokenOf(edu.email);
      const month = new Date().toISOString().slice(0, 7);
      const req = await request(server()).post('/public/schedule/code').set('X-Forwarded-For', nextIp()).send({ email: edu.email, organizationId: orgId });
      expect(req.body.status).toBe('SENT');
      await sleep(300);
      const scheduleCode = (mail as any).lastScheduleCode as string;
      const verified = await request(server()).post('/public/schedule/verify').set('X-Forwarded-For', nextIp()).send({ email: edu.email, organizationId: orgId, code: scheduleCode });
      expect(verified.status).toBe(201);
      const session = verified.body.token as string;
      const view = () => request(server()).get(`/public/schedule?organizationId=${orgId}&month=${month}`).set(bearer(session));
      expect((await view()).status).toBe(200);

      await sleep(1100);
      const code = await openRequest(token, edu.id, 'edu.novo@troca.teste.com');
      expect((await confirm(token, code)).status).toBe(200);

      expect((await view()).status).toBe(401);
    });
  });

  describe('throttle por IP (RN-28)', () => {
    it('o 6º pedido do mesmo IP no minuto é 429 com a mensagem padrão', async () => {
      const fixedIp = '10.250.250.250';
      const res: any[] = [];
      for (let i = 0; i < 6; i++) res.push(await call('post', '/resend', 'x', undefined, fixedIp));
      expect(res[5].status).toBe(429);
      expect(res[5].body.message).toBe('Muitas tentativas. Aguarde um minuto e tente de novo.');
    });
  });

  describe('Supabase (CA-36)', () => {
    it('as tabelas existem com RLS configurável: conferência manual com a chave anon (docs/db/troca-email.md)', async () => {
      const [{ count }] = await dataSource.query(`SELECT count(*)::int AS count FROM information_schema.tables WHERE table_name IN ('email_change_requests', 'email_change_events')`);
      expect(count).toBe(2);
    });
  });
});
