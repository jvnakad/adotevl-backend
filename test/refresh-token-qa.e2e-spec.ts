import { SessionFixture, EXPIRED_BODY } from './session-fixture';
import { TeamService } from '../src/team/team.service';
import { TeamMembershipService } from '../src/team/team-membership.service';
import { TeamSystemKey } from '../src/team/team.entity';

/**
 * QA-02 (refresh-token): bordas de relógio e snapshot do 401 que os e2e da feature cobrem só em unitário ou só em parte.
 * CA-04 (as 4 faixas da limpeza, exatas), CA-10 (borda de 7 dias), CA-11 (deslizante por 10 dias), CA-58 (1 ms na API real) e CA-62 (401 idêntico).
 */
describe('QA-02 refresh-token: bordas de relógio e 401 único (e2e)', () => {
  let t: SessionFixture;

  beforeAll(async () => {
    t = await SessionFixture.boot('77777777777792', 'Refresh QA');
  }, 60000);
  afterAll(async () => {
    await t.close();
  }, 60000);

  const fidOf = (s: { access: string }) => (t.jwt.decode(s.access) as any).fid as string;
  const families = async (userId: string) => new Set((await t.familiesOf(userId)).map((r: any) => r.family_id as string));

  describe('CA-04: as 4 faixas da limpeza', () => {
    it('(1) viva de 20 dias fica; (2) morta há 3 dias fica; (3) morta há mais de 7 dias sai inteira; (4) iniciada há 45 dias sai inteira; outro usuário intacto', async () => {
      const ana = await t.createUser('Ana Limpa');
      const other = await t.createUser('Outro Limpa');
      const otherDead = await t.session(other.email);
      await t.dataSource.query(`UPDATE refresh_tokens SET revoked_at = now() - interval '30 days', created_at = now() - interval '40 days', expires_at = now() - interval '33 days' WHERE family_id = $1`, [fidOf(otherDead)]);

      const f1 = await t.session(ana.email);
      const f1b = (await t.refresh(f1.refresh)).body; // 2 linhas na família 1
      const f2 = await t.session(ana.email);
      const f3 = await t.session(ana.email);
      const f4 = await t.session(ana.email);
      const fam1 = fidOf(f1);
      // (1) viva de 20 dias, com linha consumida vencida há mais de 7 dias
      await t.dataSource.query(
        `UPDATE refresh_tokens SET created_at = now() - interval '20 days', expires_at = now() - interval '13 days', used_at = now() - interval '20 days', family_started_at = now() - interval '20 days' WHERE family_id = $1 AND used_at IS NOT NULL`,
        [fam1],
      );
      await t.dataSource.query(`UPDATE refresh_tokens SET created_at = now() - interval '1 day', expires_at = now() + interval '6 days', family_started_at = now() - interval '20 days' WHERE family_id = $1 AND used_at IS NULL`, [fam1]);
      // (2) sem ponta viva, última linha morreu (revogação) há 3 dias
      await t.dataSource.query(`UPDATE refresh_tokens SET revoked_at = now() - interval '3 days', created_at = now() - interval '5 days', expires_at = now() + interval '2 days' WHERE family_id = $1`, [fidOf(f2)]);
      // (3) sem ponta viva, todas morreram há mais de 7 dias
      await t.dataSource.query(`UPDATE refresh_tokens SET revoked_at = now() - interval '9 days', created_at = now() - interval '12 days', expires_at = now() - interval '5 days' WHERE family_id = $1`, [fidOf(f3)]);
      // (4) iniciada há 45 dias (ainda com ponta "viva" em tese)
      await t.dataSource.query(`UPDATE refresh_tokens SET family_started_at = now() - interval '45 days' WHERE family_id = $1`, [fidOf(f4)]);

      const login = await t.session(ana.email); // dispara a limpeza do login (depois da resposta)
      await t.settle();
      const left = await families(ana.id);
      expect(left.has(fam1)).toBe(true);
      expect(left.has(fidOf(f2))).toBe(true);
      expect(left.has(fidOf(f3))).toBe(false);
      expect(left.has(fidOf(f4))).toBe(false);
      expect(left.has(fidOf(login))).toBe(true);
      // linhas da família 1 todas presentes (nada solto apagado)
      expect((await t.rowsOf(ana.id)).filter((r: any) => r.family_id === fam1)).toHaveLength(2);
      // outro usuário não é tocado pela limpeza de Ana
      expect((await families(other.id)).has(fidOf(otherDead))).toBe(true);
      expect(f1b.refresh_token).toBeTruthy();
    });

    it('renovar a família (1) não apaga nada dela, e apaga a família (3) de outro login do mesmo usuário', async () => {
      const bia = await t.createUser('Bia Limpa');
      const live = await t.session(bia.email);
      const dead = await t.session(bia.email);
      await t.dataSource.query(`UPDATE refresh_tokens SET revoked_at = now() - interval '9 days', created_at = now() - interval '12 days', expires_at = now() - interval '5 days' WHERE family_id = $1`, [fidOf(dead)]);
      const before = (await t.rowsOf(bia.id)).filter((r: any) => r.family_id === fidOf(live)).length;

      const res = await t.refresh(live.refresh);

      expect(res.status).toBe(200);
      // a limpeza roda depois da resposta, sem await
      await t.settle();
      const fams = await families(bia.id);
      expect(fams.has(fidOf(dead))).toBe(false);
      expect(fams.has(fidOf(live))).toBe(true);
      expect((await t.rowsOf(bia.id)).filter((r: any) => r.family_id === fidOf(live)).length).toBe(before + 1);
    });
  });

  describe('CA-10 e CA-11: expiração e deslizante', () => {
    it('CA-10: 6 d 23 h 59 min 50 s renova; 7 d + 10 s dá 401 sem revogar', async () => {
      const cid = await t.createUser('Cid Borda');
      const s = await t.session(cid.email);
      await t.dataSource.query(`UPDATE refresh_tokens SET created_at = now() - interval '6 days 23 hours 59 minutes 50 seconds', expires_at = now() + interval '10 seconds' WHERE user_id = $1`, [cid.id]);
      const ok = await t.refresh(s.refresh);
      expect(ok.status).toBe(200);
      await t.dataSource.query(`UPDATE refresh_tokens SET created_at = now() - interval '7 days 10 seconds', expires_at = now() - interval '10 seconds' WHERE user_id = $1 AND used_at IS NULL`, [cid.id]);
      const late = await t.refresh(ok.body.refresh_token);
      expect(late.status).toBe(401);
      expect(late.body).toEqual(EXPIRED_BODY);
      expect((await t.rowsOf(cid.id)).every((r: any) => r.revoked_at === null)).toBe(true);
    });

    it('CA-11: renovada todo dia por 10 dias seguidos, a última renovação dá 200', async () => {
      const dora = await t.createUser('Dora Deslizante');
      let current = (await t.session(dora.email)).refresh;
      for (let day = 1; day <= 10; day++) {
        // envelhece a família inteira em 1 dia
        await t.dataSource.query(
          `UPDATE refresh_tokens SET created_at = created_at - interval '1 day', expires_at = expires_at - interval '1 day', family_started_at = family_started_at - interval '1 day', used_at = used_at - interval '1 day' WHERE user_id = $1`,
          [dora.id],
        );
        const res = await t.refresh(current);
        expect(res.status).toBe(200);
        current = res.body.refresh_token;
      }
      const [tip] = (await t.rowsOf(dora.id)).filter((r: any) => r.used_at === null);
      expect(new Date(tip.expires_at).getTime() - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
    });
  });

  describe('CA-58: 1 ms na API real', () => {
    it('família iniciada 1 ms antes de password_changed_at é recusada; no mesmo ms é aceita', async () => {
      const eli = await t.createUser('Eli Milissegundo');
      const a = await t.session(eli.email);
      const [row] = await t.rowsOf(eli.id);
      const started = new Date(row.family_started_at);
      await t.dataSource.query(`UPDATE users SET password_changed_at = $1 WHERE id = $2`, [new Date(started.getTime()), eli.id]);
      const same = await t.refresh(a.refresh);
      expect(same.status).toBe(200);

      await t.dataSource.query(`UPDATE users SET password_changed_at = $1 WHERE id = $2`, [new Date(started.getTime() + 1), eli.id]);
      const before = await t.refresh(same.body.refresh_token);
      expect(before.status).toBe(401);
      expect((await t.rowsOf(eli.id)).every((r: any) => r.revoked_at !== null)).toBe(true);
    });
  });

  describe('CA-62: o 401 de /auth/refresh é idêntico em todos os motivos', () => {
    const strip = (headers: Record<string, string>) => {
      const copy = { ...headers };
      delete copy.date;
      return copy;
    };

    it('inexistente, vencido, reuso, inativo, não confirmado, volante, senha trocada e teto: mesmo status, corpo e headers, sem reason', async () => {
      const results: Record<string, { status: number; body: unknown; headers: Record<string, string> }> = {};
      const grab = (key: string, res: any) => (results[key] = { status: res.status, body: res.body, headers: strip(res.headers) });

      grab('inexistente', await t.refresh('Y'.repeat(43)));

      const venc = await t.createUser('Vera Vencido');
      const vs = await t.session(venc.email);
      await t.dataSource.query(`UPDATE refresh_tokens SET created_at = now() - interval '7 days 1 minute', expires_at = now() - interval '1 minute' WHERE user_id = $1`, [venc.id]);
      grab('vencido', await t.refresh(vs.refresh));

      const reuso = await t.createUser('Rui Reuso');
      const rs = await t.session(reuso.email);
      await t.refresh(rs.refresh);
      grab('reuso', await t.refresh(rs.refresh));

      const inativo = await t.createUser('Iara Inativa');
      const is = await t.session(inativo.email);
      await t.dataSource.query(`UPDATE users SET "isActive" = false WHERE id = $1`, [inativo.id]);
      grab('inativo', await t.refresh(is.refresh));

      const nconf = await t.createUser('Nina Naoconf');
      const ns = await t.session(nconf.email);
      await t.dataSource.query(`UPDATE users SET is_confirmed = false WHERE id = $1`, [nconf.id]);
      grab('nao_confirmado', await t.refresh(ns.refresh));

      const volante = await t.createUser('Vitor Volante');
      const vos = await t.session(volante.email);
      const floating = await t.app.get(TeamService).systemTeam(t.orgId, TeamSystemKey.FLOATING_VOLUNTEER);
      await t.app.get(TeamMembershipService).assign({ birthDate: null, ...volante } as any, floating.id, null);
      grab('volante', await t.refresh(vos.refresh));

      const senha = await t.createUser('Sara Senha');
      const ss = await t.session(senha.email);
      await t.dataSource.query(`UPDATE users SET password_changed_at = now() + interval '1 second' WHERE id = $1`, [senha.id]);
      grab('senha_trocada', await t.refresh(ss.refresh));

      const teto = await t.createUser('Tom Teto');
      const ts = await t.session(teto.email);
      await t.dataSource.query(`UPDATE refresh_tokens SET family_started_at = now() - interval '31 days' WHERE user_id = $1`, [teto.id]);
      grab('teto', await t.refresh(ts.refresh));

      const [reference] = Object.values(results);
      for (const [key, value] of Object.entries(results)) {
        expect({ key, ...value }).toEqual({ key, status: 401, body: EXPIRED_BODY, headers: reference.headers });
        expect(JSON.stringify(value.body)).not.toContain('reason');
      }
      expect(Object.keys(results)).toHaveLength(8);
    });
  });
});
