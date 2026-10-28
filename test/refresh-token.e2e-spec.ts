// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { createHash, randomUUID } from 'crypto';
import { SessionFixture, EXPIRED_BODY, REFRESH_FORMAT, UUID_FORMAT, unknownRefresh } from './session-fixture';
import { hashRefresh, REFRESH_CLEANUP_SQL } from '../src/auth/refresh-token.service';
import { SESSION_STATE_SQL } from '../src/auth/session-state';
import { TeamService } from '../src/team/team.service';
import { TeamMembershipService } from '../src/team/team-membership.service';
import { TeamSystemKey } from '../src/team/team.entity';
import { REFRESH_PURGE_FAMILY_AGE_DAYS, REFRESH_RETENTION_DAYS } from '../src/auth/refresh-token.entity';

const p95 = (samples: number[]) => [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * 0.95) - 1];
const DAY = 86_400_000;

describe('Sessão do painel: refresh token (e2e)', () => {
  let t: SessionFixture;

  beforeAll(async () => {
    // 1 minuto: o exp - iat do access prova que o TTL vem do ACCESS_TOKEN_TTL (CA-02)
    t = await SessionFixture.boot('77777777777781', 'Refresh Sessao', { accessTtl: '1m' });
  }, 60000);
  afterAll(async () => {
    await t.close();
  }, 60000);

  describe('login e rotação (CA-01, CA-02, CA-06, CA-07, CA-08)', () => {
    it('CA-01/CA-02: o login devolve o par, o access traz fid e vale 60 s, e a tabela guarda só o HMAC', async () => {
      const ana = await t.createUser('Ana Login');

      const res = await t.login(ana.email);

      expect(res.status).toBe(201);
      expect(Object.keys(res.body).sort()).toEqual(['access_token', 'refresh_token', 'user']);
      expect(res.body.refresh_token).toMatch(REFRESH_FORMAT);
      const claims = t.jwt.decode(res.body.access_token) as any;
      expect(claims.fid).toMatch(UUID_FORMAT);
      expect(claims.exp - claims.iat).toBe(60);
      expect(claims).not.toHaveProperty('scope');
      expect(claims.sub).toBe(ana.id);

      const rows = await t.rowsOf(ana.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].family_id).toBe(claims.fid);
      expect(rows[0].token_hash).toBe(hashRefresh(res.body.refresh_token));
      expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
      // O valor entregue ao cliente não está em coluna nenhuma, nem o SHA-256 puro dele
      expect(JSON.stringify(rows)).not.toContain(res.body.refresh_token);
      expect(rows[0].token_hash).not.toBe(createHash('sha256').update(res.body.refresh_token).digest('hex'));
      expect((await t.me(res.body.access_token)).status).toBe(200);
    });

    it('CA-06: a renovação devolve outro par da mesma família, consome o refresh usado e herda o início da família', async () => {
      const bia = await t.createUser('Bia Rotacao');
      const first = await t.session(bia.email);

      const res = await t.refresh(first.refresh);

      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(['access_token', 'refresh_token']);
      expect(res.body.refresh_token).toMatch(REFRESH_FORMAT);
      expect(res.body.refresh_token).not.toBe(first.refresh);
      const [before, after] = [t.jwt.decode(first.access) as any, t.jwt.decode(res.body.access_token) as any];
      expect(after.fid).toBe(before.fid);
      const rows = await t.rowsOf(bia.id);
      expect(rows).toHaveLength(2);
      expect(rows[0].used_at).not.toBeNull();
      expect(rows[1].used_at).toBeNull();
      expect(rows[1].family_id).toBe(rows[0].family_id);
      expect(new Date(rows[1].family_started_at).getTime()).toBe(new Date(rows[0].family_started_at).getTime());
      expect((await t.me(res.body.access_token)).status).toBe(200);
    });

    it('CA-07/CA-08: reapresentar o refresh já usado dá o 401 único e revoga a família, inclusive o par mais novo', async () => {
      const caio = await t.createUser('Caio Reuso');
      const first = await t.session(caio.email);
      const second = (await t.refresh(first.refresh)).body;

      const reuse = await t.refresh(first.refresh);

      expect(reuse.status).toBe(401);
      expect(reuse.body).toEqual(EXPIRED_BODY);
      expect((await t.refresh(second.refresh_token)).status).toBe(401);
      expect((await t.me(second.access_token)).status).toBe(401);
      expect((await t.me(first.access)).status).toBe(401);
      const rows = await t.rowsOf(caio.id);
      expect(rows.every((row: any) => row.revoked_at !== null)).toBe(true);
      expect(t.logs.some((l) => l.includes('"event":"auth.refresh_reuse"') && l.includes(caio.id))).toBe(true);
    });

    it('refresh inexistente, bem formado: 401 único e nada é revogado (CA-12)', async () => {
      const duda = await t.createUser('Duda Inexistente');
      const live = await t.session(duda.email);

      const res = await t.refresh(unknownRefresh());

      expect(res.status).toBe(401);
      expect(res.body).toEqual(EXPIRED_BODY);
      expect((await t.me(live.access)).status).toBe(200);
      expect((await t.rowsOf(duda.id)).every((row: any) => row.revoked_at === null)).toBe(true);
    });

    it('linha forjada com SHA-256 puro, sem a chave HMAC, não vira sessão (CA-59, SEC-02)', async () => {
      const edu = await t.createUser('Edu Forjado');
      const forged = 'F'.repeat(43);
      await t.dataSource.query(
        `INSERT INTO refresh_tokens (user_id, family_id, family_started_at, token_hash, expires_at) VALUES ($1, $2, now(), $3, now() + interval '7 days')`,
        [edu.id, randomUUID(), createHash('sha256').update(forged).digest('hex')],
      );

      const res = await t.refresh(forged);

      expect(res.status).toBe(401);
      expect(res.body).toEqual(EXPIRED_BODY);
    });
  });

  describe('expiração e teto, com datas forjadas no banco (CA-10, CA-11, CA-57)', () => {
    const age = (familyId: string, patch: string) => t.dataSource.query(`UPDATE refresh_tokens SET ${patch} WHERE family_id = $1`, [familyId]);
    const familyOf = async (userId: string) => (await t.rowsOf(userId))[0].family_id as string;

    it('6 dias e 23 h ainda renova; 7 dias e 1 min dá 401 sem revogar nada (vencido nunca consumido)', async () => {
      const fabi = await t.createUser('Fabi Prazo');
      const alive = await t.session(fabi.email);
      const familyId = await familyOf(fabi.id);
      // criado há 6 d 23 h: faltam 1 h para vencer
      await age(familyId, `created_at = now() - interval '6 days 23 hours', expires_at = now() + interval '1 hour'`);
      const ok = await t.refresh(alive.refresh);
      expect(ok.status).toBe(200);

      // o par novo, criado há 7 d 1 min: venceu há 1 min
      await age(familyId, `created_at = now() - interval '7 days 1 minute', expires_at = now() - interval '1 minute'`);
      const late = await t.refresh(ok.body.refresh_token);
      expect(late.status).toBe(401);
      expect(late.body).toEqual(EXPIRED_BODY);
      // nada foi revogado: a recusa por expiração não é prova de roubo
      expect((await t.rowsOf(fabi.id)).every((row: any) => row.revoked_at === null)).toBe(true);
    });

    it('consumido e vencido também é reuso: revoga a família (CA-56)', async () => {
      const gabi = await t.createUser('Gabi Vencido');
      const first = await t.session(gabi.email);
      const second = (await t.refresh(first.refresh)).body;
      const familyId = await familyOf(gabi.id);
      await age(familyId, `created_at = now() - interval '9 days', expires_at = now() - interval '2 days'`);

      const res = await t.refresh(first.refresh);

      expect(res.status).toBe(401);
      expect((await t.rowsOf(gabi.id)).every((row: any) => row.revoked_at !== null)).toBe(true);
      expect((await t.refresh(second.refresh_token)).status).toBe(401);
    });

    it('CA-57: 29 dias e 23 h renova; 30 dias e 1 min dá 401 e revoga a família (teto)', async () => {
      const hugo = await t.createUser('Hugo Teto');
      const first = await t.session(hugo.email);
      const familyId = await familyOf(hugo.id);
      await age(familyId, `family_started_at = now() - interval '29 days 23 hours'`);
      const ok = await t.refresh(first.refresh);
      expect(ok.status).toBe(200);

      await age(familyId, `family_started_at = now() - interval '30 days 1 minute'`);
      const capped = await t.refresh(ok.body.refresh_token);

      expect(capped.status).toBe(401);
      expect(capped.body).toEqual(EXPIRED_BODY);
      expect((await t.rowsOf(hugo.id)).every((row: any) => row.revoked_at !== null)).toBe(true);
      expect((await t.me(ok.body.access_token)).status).toBe(401);
      expect(t.logs.some((l) => l.includes('"motivo":"teto"'))).toBe(true);
    });
  });

  describe('logout (CA-18, CA-19, CA-20)', () => {
    it('CA-18: 204, e o access antigo e o refresh passam a dar 401 na hora (logout seguido de /auth/me)', async () => {
      const iara = await t.createUser('Iara Logout');
      const s = await t.session(iara.email);
      expect((await t.me(s.access)).status).toBe(200);

      const res = await t.logout(s.refresh);

      expect(res.status).toBe(204);
      expect(res.text).toBe('');
      expect((await t.me(s.access)).status).toBe(401);
      expect((await t.refresh(s.refresh)).status).toBe(401);
      expect(t.logs.some((l) => l.includes('"event":"auth.logout"') && l.includes(iara.id))).toBe(true);
    });

    it('CA-19: idempotente — inexistente, já revogado e repetido dão 204 e não derrubam ninguém', async () => {
      const joao = await t.createUser('Joao Idem');
      const other = await t.session(joao.email);
      const s = await t.session(joao.email);

      expect((await t.logout(unknownRefresh())).status).toBe(204);
      expect((await t.logout(s.refresh)).status).toBe(204);
      expect((await t.logout(s.refresh)).status).toBe(204);
      expect((await t.me(other.access)).status).toBe(200);
    });

    it('CA-20: o logout de um navegador não derruba o outro do mesmo usuário', async () => {
      const kika = await t.createUser('Kika Dois');
      const [a, b] = [await t.session(kika.email), await t.session(kika.email)];

      await t.logout(a.refresh);

      expect((await t.me(a.access)).status).toBe(401);
      expect((await t.me(b.access)).status).toBe(200);
      expect((await t.refresh(b.refresh)).status).toBe(200);
    });
  });

  describe('concorrência (CA-09)', () => {
    it('2 renovações simultâneas com o mesmo refresh: no máximo uma responde 200 e a família cai', async () => {
      const lia = await t.createUser('Lia Dupla');
      const s = await t.session(lia.email);

      const results = await Promise.all([t.refresh(s.refresh), t.refresh(s.refresh)]);

      const ok = results.filter((r) => r.status === 200);
      expect(ok.length).toBeLessThanOrEqual(1);
      for (const r of results.filter((x) => x.status !== 200)) expect(r.status).toBe(401);
      // Quem perdeu a corrida é reuso: nem o par que a vencedora emitiu sobrevive
      if (ok[0]) expect((await t.refresh(ok[0].body.refresh_token)).status).toBe(401);
    });

    it('50 renovações simultâneas com o mesmo refresh: no máximo 1 resposta 200', async () => {
      const mara = await t.createUser('Mara Cinquenta');
      const s = await t.session(mara.email);

      const results = await Promise.all(Array.from({ length: 50 }, () => t.refresh(s.refresh)));

      const statuses = results.map((r) => r.status);
      expect(statuses.filter((x) => x === 200).length).toBeLessThanOrEqual(1);
      expect(statuses.every((x) => [200, 401].includes(x))).toBe(true);
    }, 30000);
  });

  describe('DTO e confusão de tokens (CA-15, CA-16, CA-17)', () => {
    it.each([
      ['ausente', undefined],
      ['número', 123],
      ['lista', [unknownRefresh()]],
      ['vazio', ''],
      ['42 caracteres', 'A'.repeat(42)],
      ['44 caracteres', 'A'.repeat(44)],
      ['513 caracteres', 'A'.repeat(513)],
      ['caractere inválido', `${'A'.repeat(42)}+`],
    ])('refresh/logout com refreshToken %s dão 400 sem repetir o valor', async (_label, value) => {
      for (const call of [t.refresh, t.logout]) {
        const res = await call(value);

        expect(res.status).toBe(400);
        expect(Array.isArray(res.body.message)).toBe(true);
        if (typeof value === 'string' && value.length > 3) expect(JSON.stringify(res.body)).not.toContain(value);
      }
    });

    it('CA-17: um JWT (access do painel) no lugar do refresh dá 400 e não revoga a sessão', async () => {
      const nina = await t.createUser('Nina Jwt');
      const s = await t.session(nina.email);

      const res = await t.refresh(s.access);
      const out = await t.logout(s.access);

      expect(res.status).toBe(400);
      expect(out.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toContain(s.access);
      expect((await t.me(s.access)).status).toBe(200);
      expect((await t.refresh(s.refresh)).status).toBe(200);
    });

    it('o header Authorization não substitui o corpo: Bearer válido com corpo inválido continua 400', async () => {
      const otto = await t.createUser('Otto Header');
      const s = await t.session(otto.email);

      const res = await request(t.server()).post('/auth/refresh').set(t.bearer(s.access)).set('X-Forwarded-For', t.nextIp()).send({});

      expect(res.status).toBe(400);
    });

    it('refresh no Authorization de uma rota protegida dá 401 (não é JWT)', async () => {
      const paula = await t.createUser('Paula Bearer');
      const s = await t.session(paula.email);

      expect((await request(t.server()).get('/auth/me').set(t.bearer(s.refresh))).status).toBe(401);
    });

    it('SEC-09: access com o fid de uma família viva de OUTRO usuário dá 401 (o EXISTS amarra o usuário)', async () => {
      const [quim, rosa] = [await t.createUser('Quim Dono'), await t.createUser('Rosa Alheia')];
      await t.session(quim.email);
      const rosaSession = await t.session(rosa.email);
      const rosaFid = (t.jwt.decode(rosaSession.access) as any).fid;

      // Token assinado com o segredo certo, sub do Quim e fid da família da Rosa (só possível forjando o JWT)
      const forged = t.jwt.sign({ sub: quim.id, email: quim.email, profileId: t.profileId, organizationId: t.orgId, fid: rosaFid });

      expect((await t.me(forged)).status).toBe(401);
      expect((await t.me(rosaSession.access)).status).toBe(200);
    });

    it('fid malformado dá 401, nunca 500', async () => {
      const sara = await t.createUser('Sara Malformado');
      const forged = t.jwt.sign({ sub: sara.id, email: sara.email, profileId: t.profileId, organizationId: t.orgId, fid: "x'; DROP TABLE users;--" });

      expect((await t.me(forged)).status).toBe(401);
    });
  });

  describe('SEC-BUG-03: só application/json em refresh e logout (415)', () => {
    const rowState = async (userId: string) => JSON.stringify((await t.rowsOf(userId)).map((row: any) => [row.id, row.used_at, row.revoked_at]));

    it('form urlencoded com um refresh válido dá 415 e NÃO rotaciona nem revoga', async () => {
      const tina = await t.createUser('Tina Form');
      const s = await t.session(tina.email);
      const before = await rowState(tina.id);

      const refresh = await request(t.server()).post('/auth/refresh').set('X-Forwarded-For', t.nextIp()).type('form').send({ refreshToken: s.refresh });
      const logout = await request(t.server()).post('/auth/logout').set('X-Forwarded-For', t.nextIp()).type('form').send({ refreshToken: s.refresh });

      for (const res of [refresh, logout]) {
        expect(res.status).toBe(415);
        expect(res.body).toEqual({ statusCode: 415, message: 'Content-Type deve ser application/json.', error: 'Unsupported Media Type' });
      }
      expect(await rowState(tina.id)).toBe(before);
      expect((await t.me(s.access)).status).toBe(200);
    });

    it('text/plain e sem Content-Type dão 415', async () => {
      const ugo = await t.createUser('Ugo Texto');
      const s = await t.session(ugo.email);
      const before = await rowState(ugo.id);

      const plain = await request(t.server()).post('/auth/refresh').set('X-Forwarded-For', t.nextIp()).set('Content-Type', 'text/plain').send(JSON.stringify({ refreshToken: s.refresh }));
      const none = await request(t.server()).post('/auth/logout').set('X-Forwarded-For', t.nextIp());

      expect(plain.status).toBe(415);
      expect(none.status).toBe(415);
      expect(await rowState(ugo.id)).toBe(before);
    });

    it('application/json e application/json; charset=utf-8 seguem o fluxo normal', async () => {
      const vera = await t.createUser('Vera Json');
      const s = await t.session(vera.email);

      const plain = await request(t.server()).post('/auth/refresh').set('X-Forwarded-For', t.nextIp()).set('Content-Type', 'application/json').send(JSON.stringify({ refreshToken: s.refresh }));
      expect(plain.status).toBe(200);
      const charset = await request(t.server())
        .post('/auth/logout')
        .set('X-Forwarded-For', t.nextIp())
        .set('Content-Type', 'application/json; charset=utf-8')
        .send(JSON.stringify({ refreshToken: plain.body.refresh_token }));
      expect(charset.status).toBe(204);
    });

    it('/auth/login e as outras rotas não mudam', async () => {
      const wilma = await t.createUser('Wilma Login');

      const form = await request(t.server()).post('/auth/login').set('X-Forwarded-For', t.nextIp()).type('form').send({ email: wilma.email, password: 'senha123' });

      expect(form.status).toBe(201);
    });
  });

  describe('throttle por IP (CA-16)', () => {
    it('o 11º login do mesmo IP no minuto dá 429 com Retry-After', async () => {
      const ip = '10.77.1.1';
      const statuses: number[] = [];
      for (let i = 0; i < 10; i++) statuses.push((await t.login('ninguem@sessao.teste.com', 'x', ip)).status);
      const blocked = await t.login('ninguem@sessao.teste.com', 'x', ip);

      expect(statuses.every((s) => s === 401)).toBe(true);
      expect(blocked.status).toBe(429);
      expect(blocked.body).toEqual({ statusCode: 429, message: 'Muitas tentativas. Aguarde um minuto e tente de novo.' });
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      expect(blocked.headers['x-ratelimit-limit']).toBeUndefined();
      // Outro IP não é afetado
      expect((await t.login('ninguem@sessao.teste.com', 'x', '10.77.1.2')).status).toBe(401);
    });

    it('a 31ª chamada a refresh e a 31ª a logout do mesmo IP dão 429', async () => {
      for (const [call, ok] of [
        [t.refresh, 401],
        [t.logout, 204],
      ] as const) {
        const ip = call === t.refresh ? '10.77.2.1' : '10.77.2.2';
        for (let i = 0; i < 30; i++) expect((await call(unknownRefresh(), ip)).status).toBe(ok);
        const blocked = await call(unknownRefresh(), ip);

        expect(blocked.status).toBe(429);
        expect(blocked.headers['retry-after']).toBeDefined();
      }
    }, 60000);
  });

  describe('limite de 10 famílias (CA-60)', () => {
    it('o 11º login revoga a 1ª família: o access dela dá 401, o refresh também, e ficam 10 vivas', async () => {
      const yara = await t.createUser('Yara Onze');
      const sessions = [];
      for (let i = 0; i < 11; i++) {
        sessions.push(await t.session(yara.email));
        // Famílias com início distinto para a ordem ser determinística
        await t.sleep(5);
      }

      expect((await t.me(sessions[0].access)).status).toBe(401);
      expect((await t.refresh(sessions[0].refresh)).status).toBe(401);
      for (const s of sessions.slice(1)) expect((await t.me(s.access)).status).toBe(200);
      const [{ live }] = await t.dataSource.query(
        `SELECT count(DISTINCT family_id)::int AS live FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL`,
        [yara.id],
      );
      expect(live).toBe(10);
      expect(t.logs.some((l) => l.includes('"event":"auth.refresh_family_evicted"') && l.includes(yara.id))).toBe(true);
    }, 60000);
  });

  describe('login recusado não emite refresh (CA-05)', () => {
    it('volante com a senha certa recebe a mesma mensagem da senha errada e nenhuma linha em refresh_tokens', async () => {
      const vivi = await t.createUser('Vivi Volante');
      const floating = await t.app.get(TeamService).systemTeam(t.orgId, TeamSystemKey.FLOATING_VOLUNTEER);
      await t.app.get(TeamMembershipService).assign({ birthDate: null, ...vivi }, floating.id, null);

      const res = await t.login(vivi.email);

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Credenciais inválidas.');
      expect(await t.rowsOf(vivi.id)).toHaveLength(0);
    });

    it('login com a senha errada não grava refresh', async () => {
      const zeca = await t.createUser('Zeca Senha');

      const res = await t.login(zeca.email, 'errada');

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Credenciais inválidas.');
      expect(await t.rowsOf(zeca.id)).toHaveLength(0);
    });
  });

  describe('limpeza que respeita a família viva (SEC-BUG-02, BE-20)', () => {
    const shift = (familyId: string, interval: string, extra = '') =>
      t.dataSource.query(`UPDATE refresh_tokens SET created_at = created_at - interval '${interval}', expires_at = expires_at - interval '${interval}' ${extra} WHERE family_id = $1`, [familyId]);

    it('família de 20 dias com a linha consumida do dia 1 sobrevive ao login e à renovação, e reapresentar essa linha revoga a família', async () => {
      const abel = await t.createUser('Abel Vinte');
      const first = await t.session(abel.email);
      const second = (await t.refresh(first.refresh)).body;
      const [row0, row1] = await t.rowsOf(abel.id);
      const familyId = row0.family_id as string;
      // linha do dia 1: criada há 20 dias, venceu há 13; a ponta nasceu há 1 dia; a família começou há 20 dias
      await t.dataSource.query(
        `UPDATE refresh_tokens SET created_at = now() - interval '20 days', expires_at = now() - interval '13 days', used_at = now() - interval '20 days', family_started_at = now() - interval '20 days' WHERE id = $1`,
        [row0.id],
      );
      await t.dataSource.query(`UPDATE refresh_tokens SET created_at = now() - interval '1 day', expires_at = now() + interval '6 days', family_started_at = now() - interval '20 days' WHERE id = $1`, [row1.id]);

      await t.session(abel.email); // login: limpeza Q7 do usuário
      const rotated = await t.refresh(second.refresh_token); // renovação: limpeza Q8
      expect(rotated.status).toBe(200);
      await t.settle();

      const ids = (await t.rowsOf(abel.id)).filter((r: any) => r.family_id === familyId).map((r: any) => r.id);
      expect(ids).toEqual(expect.arrayContaining([row0.id, row1.id]));

      const replay = await t.refresh(first.refresh);
      expect(replay.status).toBe(401);
      expect(replay.body).toEqual(EXPIRED_BODY);
      expect((await t.refresh(rotated.body.refresh_token)).status).toBe(401);
    });

    it('família morta há mais de 7 dias é apagada inteira; revogada há 1 dia e a viva ficam', async () => {
      const bento = await t.createUser('Bento Limpeza');
      const [dead, recent, live, old] = [await t.session(bento.email), await t.session(bento.email), await t.session(bento.email), await t.session(bento.email)];
      const fid = (s: { access: string }) => (t.jwt.decode(s.access) as any).fid as string;
      // morta há 8 dias (revogada), revogada há 1 dia, viva, e iniciada há 50 dias (mais de 44)
      await shift(fid(dead), '9 days', `, revoked_at = now() - interval '8 days'`);
      await t.dataSource.query(`UPDATE refresh_tokens SET revoked_at = now() - interval '1 day' WHERE family_id = $1`, [fid(recent)]);
      await t.dataSource.query(`UPDATE refresh_tokens SET family_started_at = now() - interval '50 days' WHERE family_id = $1`, [fid(old)]);

      await t.session(bento.email); // Q7
      await t.settle();

      const left = new Set((await t.familiesOf(bento.id)).map((r: any) => r.family_id));
      expect(left.has(fid(dead))).toBe(false);
      expect(left.has(fid(old))).toBe(false);
      expect(left.has(fid(recent))).toBe(true);
      expect(left.has(fid(live))).toBe(true);
    });
  });

  describe('desempenho com 10⁴ linhas (arch §6)', () => {
    beforeAll(async () => {
      // 50 usuários x 10 famílias x 20 tokens (a ponta de cada família é a 20ª). Hashes aleatórios: ninguém tem o valor
      const users = [];
      for (let i = 0; i < 50; i++) users.push((await t.createUser(`Carga ${i}`)).id);
      await t.dataSource.query(
        `INSERT INTO refresh_tokens (user_id, family_id, family_started_at, token_hash, created_at, expires_at, used_at, user_agent)
         SELECT u.id, md5(u.id::text || f::text)::uuid, now() - interval '2 days', md5(random()::text || k::text) || md5(random()::text),
                now() - interval '1 hour' - (20 - k) * interval '1 minute', now() + interval '7 days' - (20 - k) * interval '1 minute',
                CASE WHEN k < 20 THEN now() - interval '30 minutes' END, 'carga'
           FROM unnest($1::uuid[]) AS u(id) CROSS JOIN generate_series(1, 10) f CROSS JOIN generate_series(1, 20) k`,
        [users],
      );
      await t.dataSource.query('VACUUM ANALYZE refresh_tokens');
    }, 120000);

    it('o EXISTS do guard (SESSION_STATE_SQL com fid) usa o índice de família', async () => {
      const dora = await t.createUser('Dora Plano');
      const s = await t.session(dora.email);
      const fid = (t.jwt.decode(s.access) as any).fid;

      const plan = (await t.dataSource.query(`EXPLAIN ${SESSION_STATE_SQL}`, [dora.id, fid])).map((r: any) => r['QUERY PLAN']).join('\n');

      expect(plan).toContain('IDX_refresh_tokens_family_revoked');
      expect(plan).not.toMatch(/Seq Scan on refresh_tokens/);
    });

    it('com 10⁴ linhas o SQL de limpeza do código usa os índices do usuário (sem Seq Scan em refresh_tokens)', async () => {
      const cora = await t.createUser('Cora Plano');
      await t.session(cora.email);
      await t.dataSource.query('ANALYZE refresh_tokens');

      const plan = (
        await t.dataSource.query(`EXPLAIN ${REFRESH_CLEANUP_SQL}`, [cora.id, REFRESH_RETENTION_DAYS, new Date(Date.now() - REFRESH_PURGE_FAMILY_AGE_DAYS * DAY), null])
      )
        .map((r: any) => r['QUERY PLAN'])
        .join('\n');

      expect(plan).not.toMatch(/Seq Scan on refresh_tokens/);
    });

    it('/auth/refresh: p95 < 150 ms em 200 chamadas encadeadas', async () => {
      const enzo = await t.createUser('Enzo Medida');
      let { refresh } = await t.session(enzo.email);
      const samples: number[] = [];
      for (let i = 0; i < 200; i++) {
        const started = process.hrtime.bigint();
        const res = await t.refresh(refresh, `10.88.${Math.floor(i / 250)}.${(i % 250) + 1}`);
        samples.push(Number(process.hrtime.bigint() - started) / 1e6);
        expect(res.status).toBe(200);
        refresh = res.body.refresh_token;
      }

      expect(p95(samples)).toBeLessThan(150);
    }, 120000);

    it('/auth/logout: p95 < 50 ms em 200 chamadas', async () => {
      const fabio = await t.createUser('Fabio Medida');
      const raws: string[] = [];
      for (let i = 0; i < 200; i++) {
        const raw = `${i}`.padStart(8, 'L') + 'Q'.repeat(35);
        raws.push(raw);
        await t.dataSource.query(`INSERT INTO refresh_tokens (user_id, family_id, family_started_at, token_hash, expires_at) VALUES ($1, $2, now(), $3, now() + interval '7 days')`, [
          fabio.id,
          randomUUID(),
          hashRefresh(raw),
        ]);
      }
      const samples: number[] = [];
      for (let i = 0; i < raws.length; i++) {
        const started = process.hrtime.bigint();
        const res = await t.logout(raws[i], `10.89.${Math.floor(i / 250)}.${(i % 250) + 1}`);
        samples.push(Number(process.hrtime.bigint() - started) / 1e6);
        expect(res.status).toBe(204);
      }

      expect(p95(samples)).toBeLessThan(50);
    }, 120000);
  });
});
