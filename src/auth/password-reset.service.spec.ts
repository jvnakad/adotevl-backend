import { BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomInt } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { PasswordResetService, FORGOT_PASSWORD_MESSAGE, INVALID_CODE_MESSAGE, EXPIRED_REQUEST_MESSAGE } from './password-reset.service';

// randomInt espiado sem trocar o comportamento padrão
jest.mock('crypto', () => {
  const actual = jest.requireActual('crypto');
  return { ...actual, randomInt: jest.fn(actual.randomInt) };
});
jest.mock('bcryptjs', () => ({
  hash: jest.fn(async (value: string) => `hashed:${value}`),
  compare: jest.fn(async (value: string, hash: string) => hash === `hashed:${value}`),
}));

const SECRET = process.env.JWT_SECRET;
const USER_ID = '8f14e45f-ceea-4e67-a1d2-0c1f3a7f9a10';
const CODE_ID = '1679091c-5a88-4faf-a9cc-3d9b6a0b8d11';
const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve));
};

describe('PasswordResetService', () => {
  let query: { getMany: jest.Mock; getOne: jest.Mock; where: jest.Mock };
  let users: { createQueryBuilder: jest.Mock };
  let dataSource: { query: jest.Mock; transaction: jest.Mock };
  let manager: { query: jest.Mock };
  let access: { forUser: jest.Mock; isFloatingVolunteer: jest.Mock };
  let mail: { sendPasswordResetCodeEmail: jest.Mock; sendPasswordChangedEmail: jest.Mock };
  let realtime: { disconnectUser: jest.Mock };
  let jwt: JwtService;
  let service: PasswordResetService;
  let logs: string[];

  const eligibleUser = { id: USER_ID, email: 'maria@exemplo.com', fullName: 'Maria Souza', isActive: true, isConfirmed: true, isApproved: true };
  const sqlOf = (call: unknown[]) => String(call[0]);

  /** Respostas do pg por trecho do SQL; o que não casa devolve "nenhuma linha". */
  const route = (mock: jest.Mock, routes: Record<string, unknown>) =>
    mock.mockImplementation(async (sql: string) => {
      const hit = Object.keys(routes).find((fragment) => sql.includes(fragment));
      return hit ? routes[hit] : [[], 0];
    });

  const openWindow = { 'FOR NO KEY UPDATE': [{ locked: false }], FILTER: [{ cooldown: false, lastHour: 0, lastDay: 0 }], 'INSERT INTO': [{ id: CODE_ID }] };

  beforeEach(() => {
    jest.clearAllMocks();
    query = { getMany: jest.fn(async () => [eligibleUser]), getOne: jest.fn(async () => eligibleUser), where: jest.fn().mockReturnThis() };
    users = { createQueryBuilder: jest.fn(() => query) };
    manager = { query: jest.fn() };
    route(manager.query, openWindow);
    dataSource = { query: jest.fn(async () => [[], 0]), transaction: jest.fn(async (callback) => callback(manager)) };
    access = { forUser: jest.fn(async () => ({ teamId: 't1' })), isFloatingVolunteer: jest.fn(async () => false) };
    mail = { sendPasswordResetCodeEmail: jest.fn(async () => undefined), sendPasswordChangedEmail: jest.fn(async () => undefined) };
    jwt = new JwtService({ secret: SECRET, signOptions: { expiresIn: '8h' } });
    realtime = { disconnectUser: jest.fn(async () => undefined) };
    service = new PasswordResetService(users as any, dataSource as any, jwt, access as any, mail as any, realtime as any);

    logs = [];
    const logger = (service as any).logger;
    for (const level of ['log', 'warn', 'error']) jest.spyOn(logger, level).mockImplementation((message: string) => logs.push(String(message)));
  });

  afterEach(() => jest.restoreAllMocks());


  describe('pedir código', () => {
    it('elegível: resposta genérica agora, código gravado só como hash e e-mail enviado depois (CA-01, CA-51)', async () => {
      const result = await service.requestCode('maria@exemplo.com', '10.0.0.1');

      expect(result).toEqual({ message: FORGOT_PASSWORD_MESSAGE });
      // Nada de elegível aconteceu ainda: tudo roda depois da resposta (RN-02)
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(mail.sendPasswordResetCodeEmail).not.toHaveBeenCalled();

      await flush();

      const [, , code] = mail.sendPasswordResetCodeEmail.mock.calls[0];
      expect(mail.sendPasswordResetCodeEmail).toHaveBeenCalledWith('maria@exemplo.com', 'Maria Souza', code);
      expect(code).toMatch(/^\d{6}$/);
      const insert = manager.query.mock.calls.find((call) => sqlOf(call).includes('INSERT INTO password_reset_codes'));
      expect(insert[1]).toEqual([USER_ID, `hashed:${code}`, 5]);
      expect(JSON.stringify(manager.query.mock.calls)).not.toContain(`"${code}"`);
    });

    it('gera o código com crypto.randomInt, com zeros à esquerda (CA-51)', async () => {
      (randomInt as jest.Mock).mockReturnValueOnce(42);

      await service.requestCode('maria@exemplo.com', 'ip');
      await flush();

      expect(randomInt).toHaveBeenCalledWith(0, 1_000_000);
      expect(mail.sendPasswordResetCodeEmail).toHaveBeenCalledWith('maria@exemplo.com', 'Maria Souza', '000042');
    });

    it('busca o e-mail sem diferenciar maiúsculas e espaços nas pontas (CA-05)', async () => {
      await service.requestCode('  Maria@Exemplo.com ', 'ip');

      expect(query.where).toHaveBeenCalledWith('lower(user.email) = :email', { email: 'maria@exemplo.com' });
    });

    it('invalida o código anterior e grava o novo na mesma transação, com a conta travada (RN-09, RN-11)', async () => {
      await service.requestCode('maria@exemplo.com', 'ip');
      await flush();

      const sqls = manager.query.mock.calls.map(sqlOf);
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(sqls[0]).toContain('FOR NO KEY UPDATE');
      expect(sqls.findIndex((sql) => sql.includes('SET used_at = now()'))).toBeLessThan(sqls.findIndex((sql) => sql.includes('INSERT INTO')));
    });

    it.each([
      ['e-mail inexistente', async () => query.getMany.mockResolvedValue([])],
      ['usuário inativo', async () => query.getMany.mockResolvedValue([{ ...eligibleUser, isActive: false }])],
      ['e-mail não confirmado', async () => query.getMany.mockResolvedValue([{ ...eligibleUser, isConfirmed: false }])],
      ['aguardando aprovação', async () => query.getMany.mockResolvedValue([{ ...eligibleUser, isApproved: false }])],
      ['sem equipe ativa', async () => access.forUser.mockResolvedValue(null)],
      ['volante, mesmo com a equipe tendo acesso a telas (CA-03)', async () => access.isFloatingVolunteer.mockResolvedValue(true)],
      ['e-mail duplicado em caixas diferentes', async () => query.getMany.mockResolvedValue([eligibleUser, { ...eligibleUser, id: 'outro' }])],
    ])('%s: mesma resposta, nenhum código gravado e nenhum e-mail (CA-02, CA-04)', async (_label, arrange) => {
      await arrange();

      const result = await service.requestCode('x@exemplo.com', 'ip');
      await flush();

      expect(result).toEqual({ message: FORGOT_PASSWORD_MESSAGE });
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(mail.sendPasswordResetCodeEmail).not.toHaveBeenCalled();
    });

    it('faz o mesmo bcrypt.hash para qualquer e-mail, existente ou não (CA-10)', async () => {
      await service.requestCode('maria@exemplo.com', 'ip');
      query.getMany.mockResolvedValue([]);
      await service.requestCode('ninguem@exemplo.com', 'ip');
      await flush();

      expect(bcrypt.hash).toHaveBeenCalledTimes(2);
      expect(bcrypt.hash).toHaveBeenCalledWith(expect.stringMatching(/^\d{6}$/), 10);
    });

    it.each([
      ['bloqueio', { 'FOR NO KEY UPDATE': [{ locked: true }] }],
      ['cooldown', { ...openWindow, FILTER: [{ cooldown: true, lastHour: 1, lastDay: 1 }] }],
      ['hora', { ...openWindow, FILTER: [{ cooldown: false, lastHour: 5, lastDay: 5 }] }],
      ['dia', { ...openWindow, FILTER: [{ cooldown: false, lastHour: 4, lastDay: 10 }] }],
    ])('limite de %s: resposta genérica, nada gravado, nenhum e-mail e evento blocked (CA-06, CA-07, CA-48)', async (reason, routes) => {
      route(manager.query, routes);

      const result = await service.requestCode('maria@exemplo.com', 'ip');
      await flush();

      expect(result).toEqual({ message: FORGOT_PASSWORD_MESSAGE });
      expect(manager.query.mock.calls.some((call) => sqlOf(call).includes('INSERT INTO'))).toBe(false);
      // Cooldown não fecha o código que ainda vale (RN-10)
      expect(manager.query.mock.calls.some((call) => sqlOf(call).includes('SET used_at'))).toBe(false);
      expect(mail.sendPasswordResetCodeEmail).not.toHaveBeenCalled();
      expect(logs).toContain(JSON.stringify({ event: 'password_reset.blocked', userId: USER_ID, reason }));
    });

    it('falha no segundo plano vai para o log sem o código e não derruba a resposta (CA-68)', async () => {
      dataSource.transaction.mockRejectedValue(new Error('conexão perdida'));

      const result = await service.requestCode('maria@exemplo.com', 'ip');
      await flush();

      expect(result.message).toBe(FORGOT_PASSWORD_MESSAGE);
      expect(logs.some((line) => line.includes('conexão perdida'))).toBe(true);
    });

    it('registra os eventos sem e-mail em claro (CA-70)', async () => {
      await service.requestCode('maria@exemplo.com', '10.0.0.1');
      query.getMany.mockResolvedValue([]);
      await service.requestCode('ninguem@exemplo.com', '10.0.0.2');
      await flush();

      expect(logs).toContain(JSON.stringify({ event: 'password_reset.requested', userId: USER_ID, ip: '10.0.0.1' }));
      expect(logs).toContain(JSON.stringify({ event: 'password_reset.requested', eligible: false, ip: '10.0.0.2' }));
      expect(logs.join('\n')).not.toContain('exemplo.com');
    });

    it('apaga códigos com mais de 7 dias depois do envio (RN-40)', async () => {
      await service.requestCode('maria@exemplo.com', 'ip');
      await flush();

      const cleanup = dataSource.query.mock.calls.find((call) => sqlOf(call).startsWith('DELETE FROM password_reset_codes'));
      expect(cleanup[1]).toEqual([7]);
    });
  });

  describe('validar código', () => {
    const latest = { 'SELECT id FROM password_reset_codes': [{ id: CODE_ID }] };
    const counted = (attempts = 1) => ({ ...latest, 'SET attempts = c.attempts + 1': [[{ id: CODE_ID, codeHash: 'hashed:482913', attempts }], 1] });

    it('código certo: consome o código e devolve um token de 10 min com segredo e escopo próprios (CA-12)', async () => {
      route(dataSource.query, { ...counted(), 'SET verified_at = now()': [[], 1] });

      const { resetToken } = await service.verifyCode('maria@exemplo.com', '482913');

      const claims: any = jwt.verify(resetToken, { secret: `${SECRET}:password-reset`, algorithms: ['HS256'] });
      expect(claims).toEqual(expect.objectContaining({ sub: USER_ID, codeId: CODE_ID, scope: 'password-reset' }));
      expect(claims.exp - claims.iat).toBe(600);
      expect(Object.keys(claims).sort()).toEqual(['codeId', 'exp', 'iat', 'scope', 'sub']);
      // O segredo do painel puro não abre esse token
      expect(() => jwt.verify(resetToken, { secret: SECRET })).toThrow();
    });

    it('código errado: mesma mensagem, tentativa já contada, e confere o bloqueio por falhas (CA-14)', async () => {
      route(dataSource.query, counted(3));

      await expect(service.verifyCode('maria@exemplo.com', '000000')).rejects.toThrow(new BadRequestException(INVALID_CODE_MESSAGE));

      const sqls = dataSource.query.mock.calls.map(sqlOf);
      expect(sqls.some((sql) => sql.includes('SET verified_at'))).toBe(false);
      expect(sqls.some((sql) => sql.includes('SET password_reset_locked_until'))).toBe(true);
      expect(logs).toContain(JSON.stringify({ event: 'password_reset.verify_failed', codeId: CODE_ID, attempts: 3 }));
    });

    it('15ª falha em 24 h: grava o bloqueio e registra o evento locked (CA-50)', async () => {
      route(dataSource.query, { ...counted(5), 'SET password_reset_locked_until': [[{ id: USER_ID }], 1] });

      await expect(service.verifyCode('maria@exemplo.com', '000000')).rejects.toThrow(INVALID_CODE_MESSAGE);

      expect(logs).toContain(JSON.stringify({ event: 'password_reset.locked', userId: USER_ID }));
    });

    it('sem linha contada (expirado, usado, 5 tentativas ou conta bloqueada): compara com hash fixo e recusa, mesmo com o código certo (CA-13, CA-14)', async () => {
      route(dataSource.query, latest);

      await expect(service.verifyCode('maria@exemplo.com', '482913')).rejects.toThrow(INVALID_CODE_MESSAGE);

      expect(bcrypt.compare).toHaveBeenCalledTimes(1);
      expect((bcrypt.compare as jest.Mock).mock.calls[0][1]).not.toBe('hashed:482913');
      // Nada foi contado: a consulta do bloqueio roda (mesmo custo), mas sem evento de falha nem de bloqueio
      expect(logs.some((line) => line.includes('verify_failed') || line.includes('"password_reset.locked"'))).toBe(false);
    });

    it.each([
      ['e-mail inexistente', async () => query.getMany.mockResolvedValue([])],
      ['volante', async () => access.isFloatingVolunteer.mockResolvedValue(true)],
      ['virou inativo depois de receber o código (CA-16)', async () => query.getMany.mockResolvedValue([{ ...eligibleUser, isActive: false }])],
    ])('%s: mesma mensagem, um bcrypt.compare e o mesmo número de consultas, sem tocar no código da conta (CA-15, SEC-BUG-02)', async (_label, arrange) => {
      route(dataSource.query, counted());
      await service.verifyCode('maria@exemplo.com', '000000').catch(() => undefined);
      const eligibleQueries = dataSource.query.mock.calls.length;
      dataSource.query.mockClear();
      (bcrypt.compare as jest.Mock).mockClear();
      await arrange();

      await expect(service.verifyCode('x@exemplo.com', '482913')).rejects.toThrow(new BadRequestException(INVALID_CODE_MESSAGE));

      expect(bcrypt.compare).toHaveBeenCalledTimes(1);
      expect((bcrypt.compare as jest.Mock).mock.calls[0][1]).not.toBe('hashed:482913');
      expect(dataSource.query.mock.calls).toHaveLength(eligibleQueries);
      // Nenhuma consulta usa o id da conta: nada foi contado nem bloqueado
      expect(dataSource.query.mock.calls.some((call) => JSON.stringify(call[1]).includes(USER_ID))).toBe(false);
      expect(access.forUser).toHaveBeenCalled();
    });

    it('duas validações do mesmo código: a que perde o UPDATE condicional não recebe token (CA-53)', async () => {
      route(dataSource.query, { ...counted(), 'SET verified_at = now()': [[], 0] });

      await expect(service.verifyCode('maria@exemplo.com', '482913')).rejects.toThrow(INVALID_CODE_MESSAGE);
    });

    it('a tentativa é contada antes do compare, num UPDATE atômico com o teto de 5 (RN-38)', async () => {
      route(dataSource.query, counted());
      (bcrypt.compare as jest.Mock).mockImplementationOnce(async () => {
        // No momento do compare a tentativa já foi gravada
        expect(dataSource.query.mock.calls.some((call) => sqlOf(call).includes('SET attempts = c.attempts + 1'))).toBe(true);
        return false;
      });

      await expect(service.verifyCode('maria@exemplo.com', '000000')).rejects.toThrow(INVALID_CODE_MESSAGE);

      const update = dataSource.query.mock.calls.find((call) => sqlOf(call).includes('SET attempts'));
      expect(sqlOf(update)).toContain('c.attempts < $2');
      expect(update[1]).toEqual([CODE_ID, 5]);
    });
  });

  describe('gravar a nova senha', () => {
    const sign = (claims: Record<string, unknown>, secret = `${SECRET}:password-reset`, options: Record<string, unknown> = {}) =>
      jwt.sign(claims, { secret, expiresIn: '10m', ...options });
    const valid = () => sign({ sub: USER_ID, codeId: CODE_ID, scope: 'password-reset' });

    beforeEach(() => route(manager.query, { 'SET password_reset_at': [[], 1] }));

    it('token válido: grava o hash e password_changed_at e fecha os códigos da conta (CA-17)', async () => {
      const result = await service.resetPassword(valid(), 'nova-senha-123', '10.0.0.1');

      expect(result).toEqual({ message: 'Senha alterada com sucesso.' });
      const sqls = manager.query.mock.calls.map(sqlOf);
      expect(sqls[0]).toContain('c.verified_at IS NOT NULL AND c.password_reset_at IS NULL');
      expect(sqls[0]).toContain('NOT EXISTS');
      const userUpdate = manager.query.mock.calls.find((call) => sqlOf(call).startsWith('UPDATE users SET password'));
      expect(userUpdate[1]).toEqual(['hashed:nova-senha-123', expect.any(Date), USER_ID]);
      expect(sqls.some((sql) => sql.includes('SET used_at = now() WHERE user_id'))).toBe(true);
      expect(logs).toContain(JSON.stringify({ event: 'password_reset.completed', userId: USER_ID, ip: '10.0.0.1' }));
    });

    it('derruba os websockets abertos da conta depois da troca (SEC-BUG-01)', async () => {
      await service.resetPassword(valid(), 'nova-senha-123', 'ip');

      expect(realtime.disconnectUser).toHaveBeenCalledWith(USER_ID);
    });

    it('avisa por e-mail que a senha foi alterada, sem esperar o envio (RN-18, RN-20)', async () => {
      await service.resetPassword(valid(), 'nova-senha-123', 'ip');

      expect(mail.sendPasswordChangedEmail).toHaveBeenCalledWith('maria@exemplo.com', 'Maria Souza');
    });

    it('hash calculado antes de abrir a transação, para o bcrypt não segurar o lock', async () => {
      await service.resetPassword(valid(), 'nova-senha-123', 'ip');

      expect((bcrypt.hash as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(dataSource.transaction.mock.invocationCallOrder[0]);
    });

    const expiresAt = Math.floor(Date.now() / 1000) - 60;
    it.each([
      ['vencido (mais de 10 min)', () => new JwtService({}).sign({ sub: USER_ID, codeId: CODE_ID, scope: 'password-reset', exp: expiresAt, iat: expiresAt - 600 }, { secret: `${SECRET}:password-reset` })],
      ['assinado com outro segredo', () => sign({ sub: USER_ID, codeId: CODE_ID, scope: 'password-reset' }, 'outro-segredo-qualquer-de-32-caracteres!!')],
      ['assinado com changeme:password-reset', () => sign({ sub: USER_ID, codeId: CODE_ID, scope: 'password-reset' }, 'changeme:password-reset')],
      ['sem scope', () => sign({ sub: USER_ID, codeId: CODE_ID })],
      ['com scope diferente', () => sign({ sub: USER_ID, codeId: CODE_ID, scope: 'schedule' })],
      ['sem codeId', () => sign({ sub: USER_ID, scope: 'password-reset' })],
      ['sem sub', () => sign({ codeId: CODE_ID, scope: 'password-reset' })],
      ['com sub que não é uuid', () => sign({ sub: "1' OR '1'='1", codeId: CODE_ID, scope: 'password-reset' })],
      ['JWT de login do painel', () => sign({ sub: USER_ID, email: 'maria@exemplo.com', organizationId: 'org-1' }, SECRET)],
      ['token da agenda', () => sign({ sub: USER_ID, scope: 'schedule', codeId: CODE_ID }, `${SECRET}:schedule`)],
      [
        'com alg none',
        () => {
          const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
          return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: USER_ID, codeId: CODE_ID, scope: 'password-reset' })}.`;
        },
      ],
      ['lixo', () => 'nao-e-um-jwt'],
    ])('token %s: pedido expirado e a senha não muda (CA-19)', async (_label, make) => {
      await expect(service.resetPassword(make(), 'nova-senha-123', 'ip')).rejects.toThrow(new BadRequestException(EXPIRED_REQUEST_MESSAGE));

      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(bcrypt.hash).not.toHaveBeenCalled();
    });

    it('quem deixou de ser elegível entre validar o código e gravar a senha é recusado (CA-23)', async () => {
      access.isFloatingVolunteer.mockResolvedValue(true);

      await expect(service.resetPassword(valid(), 'nova-senha-123', 'ip')).rejects.toThrow(EXPIRED_REQUEST_MESSAGE);

      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('usuário que não existe mais: pedido expirado', async () => {
      query.getOne.mockResolvedValue(null);

      await expect(service.resetPassword(valid(), 'nova-senha-123', 'ip')).rejects.toThrow(EXPIRED_REQUEST_MESSAGE);
    });

    it('token já usado, código substituído ou validação com mais de 10 min (0 linhas): recusa e não troca a senha (CA-18, CA-21)', async () => {
      route(manager.query, { 'SET password_reset_at': [[], 0] });

      await expect(service.resetPassword(valid(), 'nova-senha-123', 'ip')).rejects.toThrow(new BadRequestException(EXPIRED_REQUEST_MESSAGE));

      expect(manager.query.mock.calls.some((call) => sqlOf(call).startsWith('UPDATE users'))).toBe(false);
      expect(mail.sendPasswordChangedEmail).not.toHaveBeenCalled();
    });

    it('nenhum log traz senha, token ou código (CA-68)', async () => {
      const token = valid();

      await service.resetPassword(token, 'nova-senha-123', 'ip');
      await expect(service.resetPassword('lixo', 'outra-senha-456', 'ip')).rejects.toThrow();

      const all = logs.join('\n');
      for (const secret of [token, 'nova-senha-123', 'outra-senha-456']) expect(all).not.toContain(secret);
    });
  });
});
