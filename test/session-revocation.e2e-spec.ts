// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { io, Socket } from 'socket.io-client';
import { SessionFixture, EXPIRED_BODY, UUID_FORMAT } from './session-fixture';
import { joinTeam, VOLUNTEER_APPLICATION } from './test-app.module';
import { MailService } from '../src/mail/mail.service';
import { TeamService } from '../src/team/team.service';
import { AccessMigrationService } from '../src/team/access-migration.service';
import { TeamSystemKey } from '../src/team/team.entity';

type MockMail = { lastPasswordResetCode: string | null; lastEmailChangeCode: string | null };

describe('Sessão do painel: revogações e sockets por família (e2e)', () => {
  let t: SessionFixture;
  let mail: MockMail;
  let url: string;
  let adminAccess: string;
  const sockets: Socket[] = [];

  const connect = (token?: string) =>
    new Promise<{ socket: Socket; error?: string }>((resolve) => {
      const socket = io(url, { auth: token === undefined ? {} : { token }, transports: ['websocket'], reconnection: false, forceNew: true });
      sockets.push(socket);
      socket.once('connect', () => resolve({ socket }));
      socket.once('connect_error', (error) => resolve({ socket, error: error.message }));
    });
  const connected = async (token: string) => {
    const { socket, error } = await connect(token);
    if (error) throw new Error(`conexão recusada: ${error}`);
    return socket;
  };
  /** Espera o servidor derrubar o socket (até 1 s, a meta de RN-37). */
  const droppedWithin = (socket: Socket, ms = 1000) =>
    new Promise<boolean>((resolve) => {
      if (socket.disconnected) return resolve(true);
      const timer = setTimeout(() => resolve(false), ms);
      socket.once('disconnect', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  const staysConnected = async (socket: Socket, ms = 1200) => {
    await t.sleep(ms);
    return socket.connected;
  };
  const fidOf = (access: string) => (t.jwt.decode(access) as any).fid as string;
  const admin = () => t.bearer(adminAccess);
  const sleep = (ms: number) => t.sleep(ms);

  /** Depois do gatilho: o refresh recusa com o 401 único, a família cai e o access dela dá 401 (CA-13, CA-21, CA-63). */
  const expectSessionDead = async (s: { access: string; refresh: string }) => {
    const res = await t.refresh(s.refresh);
    expect(res.status).toBe(401);
    expect(res.body).toEqual(EXPIRED_BODY);
    expect((await t.me(s.access)).status).toBe(401);
    expect((await t.refresh(s.refresh)).status).toBe(401);
  };

  beforeAll(async () => {
    t = await SessionFixture.boot('77777777777782', 'Revogacao Sessao', { accessTtl: '15m' });
    url = `http://localhost:${(t.app.getHttpServer().address() as { port: number }).port}`;
    mail = t.app.get(MailService) as unknown as MockMail;
    const adminUser = await t.createUser('Admin Sessao');
    await joinTeam(t.app, adminUser, 'ADMIN');
    adminAccess = (await t.session(adminUser.email)).access;
  }, 60000);

  afterAll(async () => {
    sockets.forEach((socket) => socket.close());
    await t.close();
  }, 60000);

  describe('matriz SEC-08: o refresh recusa e a família cai (CA-13, CA-14, CA-21 a CA-24, CA-61)', () => {
    it('desativação pelo Admin', async () => {
      const user = await t.createFixed('Ana Desativada');
      const s = await t.session(user.email);

      expect((await request(t.server()).patch(`/users/${user.id}/reject`).set(admin())).status).toBe(200);

      await expectSessionDead(s);
    });

    it('troca de equipe para Voluntário Volante', async () => {
      const user = await t.createFixed('Bia Volante');
      const s = await t.session(user.email);
      const floating = await t.app.get(TeamService).systemTeam(t.orgId, TeamSystemKey.FLOATING_VOLUNTEER);

      expect((await request(t.server()).patch(`/users/${user.id}/team`).set(admin()).send({ teamId: floating.id })).status).toBe(200);

      await expectSessionDead(s);
    });

    it('conta que deixou de ser confirmada', async () => {
      const user = await t.createFixed('Caio Naoconfirmado');
      const s = await t.session(user.email);
      await t.dataSource.query('UPDATE users SET is_confirmed = false WHERE id = $1', [user.id]);

      await expectSessionDead(s);
    });

    it('conta que deixou de ser aprovada', async () => {
      const user = await t.createFixed('Duda Naoaprovada');
      const s = await t.session(user.email);
      await t.dataSource.query('UPDATE users SET is_approved = false WHERE id = $1', [user.id]);

      await expectSessionDead(s);
    });

    it('CA-21/CA-24: troca de senha pelo perfil em 2 navegadores — o par novo continua, o outro navegador e o refresh antigo caem', async () => {
      const user = await t.createFixed('Eva Dois');
      const [a, b] = [await t.session(user.email), await t.session(user.email)];
      await sleep(1100); // o access compara em segundos inteiros

      const changed = await request(t.server()).patch('/users/me/password').set(t.bearer(a.access)).set('X-Forwarded-For', t.nextIp()).send({ currentPassword: 'senha123', newPassword: 'NovaSenha#2026' });

      expect(changed.status).toBe(200);
      expect(Object.keys(changed.body).sort()).toEqual(['access_token', 'message', 'refresh_token']);
      const fresh = { access: changed.body.access_token as string, refresh: changed.body.refresh_token as string };
      expect(fidOf(fresh.access)).toMatch(UUID_FORMAT);
      expect(fidOf(fresh.access)).not.toBe(fidOf(a.access));
      // o par novo é a sessão que continua
      expect((await t.me(fresh.access)).status).toBe(200);
      const renewed = await t.refresh(fresh.refresh);
      expect(renewed.status).toBe(200);
      // as outras famílias (a antiga deste navegador e o B) caem na renovação
      await expectSessionDead(b);
      await expectSessionDead(a);
      expect((await t.me(renewed.body.access_token)).status).toBe(200);
      // CA-25: o login depois da troca abre outra família e vale
      expect((await t.login(user.email, 'NovaSenha#2026')).status).toBe(201);
    }, 30000);

    it('esqueci minha senha derruba as famílias abertas', async () => {
      const user = await t.createFixed('Fabi Esqueci');
      const s = await t.session(user.email);
      await sleep(1100);

      expect((await request(t.server()).post('/auth/forgot-password').set('X-Forwarded-For', t.nextIp()).send({ email: user.email })).status).toBe(200);
      let code: string | null = null;
      for (let i = 0; i < 200 && !code; i++) {
        await sleep(25);
        code = mail.lastPasswordResetCode;
      }
      const verified = await request(t.server()).post('/auth/forgot-password/verify').set('X-Forwarded-For', t.nextIp()).send({ email: user.email, code });
      expect(verified.status).toBe(200);
      const reset = await request(t.server()).post('/auth/reset-password').set('X-Forwarded-For', t.nextIp()).send({ resetToken: verified.body.resetToken, password: 'OutraSenha#2026' });
      expect(reset.status).toBe(200);

      await expectSessionDead(s);
      expect((await t.login(user.email, 'OutraSenha#2026')).status).toBe(201);
    }, 30000);

    it('"Resetar senha" da tela Voluntários derruba as famílias do usuário', async () => {
      const user = await t.createFixed('Gabi Reset');
      const s = await t.session(user.email);
      await sleep(1100);

      expect((await request(t.server()).patch(`/users/${user.id}/reset-password`).set(admin())).status).toBe(200);

      await expectSessionDead(s);
    }, 20000);

    it('troca de e-mail pelo Admin derruba as famílias, e o login pelo e-mail novo abre outra', async () => {
      const user = await t.createFixed('Hugo Email');
      const s = await t.session(user.email);
      await sleep(1100);

      const changed = await request(t.server()).patch(`/users/${user.id}`).set(admin()).send({ email: 'hugo.novo@revogacaosessao.teste.com' });
      expect(changed.status).toBe(200);

      await expectSessionDead(s);
      expect((await t.login('hugo.novo@revogacaosessao.teste.com')).status).toBe(201);
    }, 20000);

    it('troca do próprio e-mail derruba as famílias, inclusive a que confirmou', async () => {
      const user = await t.createFixed('Iris Email');
      const [a, b] = [await t.session(user.email), await t.session(user.email)];
      await sleep(1100);
      const ip = t.nextIp();

      const asked = await request(t.server()).post('/users/me/email-change').set(t.bearer(a.access)).set('X-Forwarded-For', ip).send({ newEmail: 'iris.nova@revogacaosessao.teste.com', currentPassword: 'senha123' });
      expect(asked.status).toBe(200);
      const confirmed = await request(t.server()).post('/users/me/email-change/confirm').set(t.bearer(a.access)).set('X-Forwarded-For', ip).send({ code: mail.lastEmailChangeCode });
      expect(confirmed.status).toBe(200);

      await expectSessionDead(a);
      await expectSessionDead(b);
      expect((await t.login('iris.nova@revogacaosessao.teste.com')).status).toBe(201);
    }, 30000);

    it('CA-14: usuário sem equipe ativa recebe o par; só as rotas com AccessGuard respondem 403', async () => {
      const user = await t.createUser('Jose Semequipe');
      const s = await t.session(user.email);

      const res = await t.refresh(s.refresh);

      expect(res.status).toBe(200);
      expect((await t.me(res.body.access_token)).status).toBe(200);
      expect((await request(t.server()).get('/users').set(t.bearer(res.body.access_token))).status).toBe(403);
    });

    it('CA-61: os claims do access novo vêm do banco, não do access antigo', async () => {
      const user = await t.createFixed('Kira Claims');
      const s = await t.session(user.email);
      await t.dataSource.query('UPDATE users SET email = $2 WHERE id = $1', [user.id, 'kira.nova@revogacaosessao.teste.com']);

      const res = await t.refresh(s.refresh);

      expect(res.status).toBe(200);
      const claims = t.jwt.decode(res.body.access_token) as any;
      expect(claims.email).toBe('kira.nova@revogacaosessao.teste.com');
      expect(claims.sub).toBe(user.id);
      expect(claims.organizationId).toBe(t.orgId);
      expect(claims.fid).toBe(fidOf(s.access));
    });
  });

  describe('tokens que não mudam', () => {
    it('CA-25: access sem fid (legado de 8 h, link de aprovação) segue as regras antigas e nunca gera refresh', async () => {
      const user = await t.createFixed('Lia Legado');
      const legacy = t.jwt.sign({ sub: user.id, email: user.email, profileId: t.profileId, profileName: 'VOLUNTEER', organizationId: t.orgId }, { expiresIn: '8h' });

      expect((await t.me(legacy)).status).toBe(200);
      expect((await t.refresh(legacy)).status).toBe(400);
      expect((await t.logout(legacy)).status).toBe(400);
      expect(await t.rowsOf(user.id)).toHaveLength(0);
      const claims = t.jwt.decode(legacy) as any;
      expect(claims.exp - claims.iat).toBe(28_800);
      expect(claims).not.toHaveProperty('fid');
    });

    it('o token do e-mail de aprovação vale 8 h (28.800 s) e não tem fid', async () => {
      const pending = await t.createFixed('Maria Pendente', { isApproved: false });
      const team = await t.app.get(TeamService).ensureAdminTeam(t.orgId);
      let sent: string | null = null;
      const mailer = t.app.get(MailService) as unknown as { sendApprovalEmail: (...args: any[]) => Promise<void> };
      const original = mailer.sendApprovalEmail;
      mailer.sendApprovalEmail = async (_to: string, _name: string, token: string) => void (sent = token);
      try {
        const res = await request(t.server()).patch(`/users/${pending.id}/approve`).set(admin()).send({ teamId: team.id });
        expect(res.status).toBe(200);
      } finally {
        mailer.sendApprovalEmail = original;
      }

      const claims = t.jwt.decode(sent) as any;
      expect(claims.exp - claims.iat).toBe(28_800);
      expect(claims).not.toHaveProperty('fid');
      expect(claims).not.toHaveProperty('scope');
      expect((await t.me(sent)).status).toBe(200);
      expect((await t.refresh(sent)).status).toBe(400);
    });

    it('a agenda (2 h, scope schedule) e o token de redefinição (10 min) não mudam e não valem como sessão', async () => {
      const user = await t.createFixed('Nina Agenda');
      const code = async () => {
        await request(t.server()).post('/public/schedule/code').set('X-Forwarded-For', t.nextIp()).send({ email: user.email, organizationId: t.orgId });
        return (t.app.get(MailService) as unknown as { lastScheduleCode: string }).lastScheduleCode;
      };
      const verified = await request(t.server()).post('/public/schedule/verify').set('X-Forwarded-For', t.nextIp()).send({ email: user.email, organizationId: t.orgId, code: await code() });
      expect(verified.status).toBe(201);
      const schedule = t.jwt.decode(verified.body.token) as any;
      expect(schedule.scope).toBe('schedule');
      expect(schedule.exp - schedule.iat).toBe(7200);

      expect((await t.me(verified.body.token)).status).toBe(401);
      expect((await t.refresh(verified.body.token)).status).toBe(400);
    }, 20000);
  });

  describe('regressão do perfil legado (CA-28)', () => {
    it('PATCH /users/:id com profileId responde como sem ele e o profile_id não muda', async () => {
      const user = await t.createFixed('Olga Perfil');
      const before = (await t.userRepo.findOne({ where: { id: user.id } })).profileId;
      const [{ id: adminProfile }] = await t.dataSource.query(`SELECT id FROM profiles WHERE name = 'ADMIN' LIMIT 1`);

      const res = await request(t.server()).patch(`/users/${user.id}`).set(admin()).send({ fullName: 'Olga Perfil Editada', profileId: adminProfile });

      expect(res.status).toBe(200);
      expect(res.body.fullName).toBe('Olga Perfil Editada');
      expect((await t.userRepo.findOne({ where: { id: user.id } })).profileId).toBe(before);
    });

    it('POST /users com profileId (cadastro público) grava o perfil legado VOLUNTEER e responde igual', async () => {
      const [{ id: adminProfile }] = await t.dataSource.query(`SELECT id FROM profiles WHERE name = 'ADMIN' LIMIT 1`);

      const res = await request(t.server())
        .post('/users')
        .set('X-Forwarded-For', t.nextIp())
        .send({
          fullName: 'Pedro Cadastro',
          cpf: '52998224725',
          email: 'pedro.cadastro@revogacaosessao.teste.com',
          phone: '11900000099',
          birthDate: '1990-04-20',
          password: 'senha123',
          profileId: adminProfile,
          consent: true,
          application: VOLUNTEER_APPLICATION,
          organizationId: t.orgId,
        });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ id: expect.any(String), email: 'pedro.cadastro@revogacaosessao.teste.com' });
      const saved = await t.dataSource.query(`SELECT p.name FROM users u JOIN profiles p ON p.id = u.profile_id WHERE u.id = $1`, [res.body.id]);
      expect(saved[0].name).toBe('VOLUNTEER');
    });
  });

  describe('sockets por família (CA-63, CA-68, CA-69, CA-70)', () => {
    it('handshake com fid de família revogada recebe UNAUTHORIZED', async () => {
      const user = await t.createFixed('Quita Handshake');
      const s = await t.session(user.email);
      await t.logout(s.refresh);

      const { error } = await connect(s.access);

      expect(error).toBe('UNAUTHORIZED');
    });

    it('CA-68: o socket cai em até 1 s depois do logout', async () => {
      const user = await t.createFixed('Rui Logout');
      const s = await t.session(user.email);
      const socket = await connected(s.access);

      await t.logout(s.refresh);

      expect(await droppedWithin(socket)).toBe(true);
    });

    it('CA-68: o socket cai em até 1 s depois do reuso', async () => {
      const user = await t.createFixed('Sol Reuso');
      const s = await t.session(user.email);
      const socket = await connected(s.access);
      const second = await t.refresh(s.refresh);
      expect(second.status).toBe(200);
      // a renovação em si não derruba o socket (o access novo só entra no auth:refresh)
      expect(socket.connected).toBe(true);

      expect((await t.refresh(s.refresh)).status).toBe(401);

      expect(await droppedWithin(socket)).toBe(true);
    });

    it('CA-68: o socket da família mais antiga cai em até 1 s quando o 11º login a expulsa', async () => {
      const user = await t.createFixed('Tati Onze');
      const first = await t.session(user.email);
      const socket = await connected(first.access);
      await sleep(5);
      for (let i = 0; i < 10; i++) {
        await t.session(user.email);
        await sleep(5);
      }

      expect(await droppedWithin(socket, 1500)).toBe(true);
    }, 60000);

    it('CA-69: revogar a família A não derruba o socket da família B do mesmo usuário', async () => {
      const user = await t.createFixed('Ugo Dois');
      const [a, b] = [await t.session(user.email), await t.session(user.email)];
      const [socketA, socketB] = [await connected(a.access), await connected(b.access)];

      await t.logout(a.refresh);

      expect(await droppedWithin(socketA)).toBe(true);
      expect(await staysConnected(socketB)).toBe(true);
    });

    it('SEC-BUG-01: room:leave de family:<fid> seguido de logout derruba o socket em até 1 s', async () => {
      const user = await t.createFixed('Vera Leave');
      const s = await t.session(user.email);
      const socket = await connected(s.access);

      const ack = (await socket.timeout(3000).emitWithAck('room:leave', { room: `family:${fidOf(s.access)}` })) as { ok: boolean };
      expect(ack.ok).toBe(true);
      const joined = (await socket.timeout(3000).emitWithAck('room:join', { room: `family:${fidOf(s.access)}` })) as { ok: boolean; error?: string };
      expect(joined).toEqual(expect.objectContaining({ ok: false, error: 'FORBIDDEN' }));
      await t.logout(s.refresh);

      expect(await droppedWithin(socket)).toBe(true);
    });

    it('CA-70: depois do auth:refresh com outra família, revogar a antiga não derruba o socket; revogar a nova derruba', async () => {
      const user = await t.createFixed('Wilma Troca');
      const [old, fresh] = [await t.session(user.email), await t.session(user.email)];
      const socket = await connected(old.access);

      const ack = (await socket.timeout(3000).emitWithAck('auth:refresh', { token: fresh.access })) as { ok: boolean };
      expect(ack.ok).toBe(true);
      await t.logout(old.refresh);
      expect(await staysConnected(socket)).toBe(true);

      await t.logout(fresh.refresh);
      expect(await droppedWithin(socket)).toBe(true);
    });

    it('auth:refresh com o access de uma família revogada volta UNAUTHORIZED', async () => {
      const user = await t.createFixed('Xuxa Ack');
      const [live, dead] = [await t.session(user.email), await t.session(user.email)];
      const socket = await connected(live.access);
      await t.logout(dead.refresh);

      const ack = (await socket.timeout(3000).emitWithAck('auth:refresh', { token: dead.access })) as { ok: boolean; error?: string };

      expect(ack).toEqual({ ok: false, error: 'UNAUTHORIZED' });
      expect(socket.connected).toBe(true);
    });
  });
  describe('migração de acesso com marca (CA-30, CA-30c, CA-31)', () => {
    it('organização com equipes e marca nula só recebe a marca: 1 linha marked_without_assignment e 0 atribuições', async () => {
      const [{ id: adminProfile }] = await t.dataSource.query(`SELECT id FROM profiles WHERE name = 'ADMIN' LIMIT 1`);
      // aprovado, de perfil ADMIN e sem vínculo: o caso que a execução "uma última vez" promoveria
      const orphan = await t.createUser('Orfao Admin', { profileId: adminProfile });
      await t.dataSource.query('UPDATE organizations SET access_migrated_at = NULL WHERE id = $1', [t.orgId]);
      t.logs.length = 0;

      await t.app.get(AccessMigrationService).onModuleInit();

      const mine = t.logs.filter((l) => l.startsWith('{') && l.includes(t.orgId)).map((l) => JSON.parse(l));
      expect(mine.filter((e) => e.event === 'access_migration.marked_without_assignment')).toHaveLength(1);
      expect(mine.filter((e) => e.event === 'access_migration.assigned')).toHaveLength(0);
      expect(await t.dataSource.query('SELECT 1 FROM volunteers WHERE user_id = $1', [orphan.id])).toHaveLength(0);
      const [{ access_migrated_at }] = await t.dataSource.query('SELECT access_migrated_at FROM organizations WHERE id = $1', [t.orgId]);
      expect(access_migrated_at).not.toBeNull();

      // marca preenchida: o segundo boot não faz nada por perfil e não repete o evento
      t.logs.length = 0;
      await t.app.get(AccessMigrationService).onModuleInit();
      expect(t.logs.some((l) => l.includes('marked_without_assignment') && l.includes(t.orgId))).toBe(false);
      expect(await t.dataSource.query('SELECT 1 FROM volunteers WHERE user_id = $1', [orphan.id])).toHaveLength(0);
    });
  });
});
