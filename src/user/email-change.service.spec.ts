import { Logger } from '@nestjs/common';
import { randomInt } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { EmailChangeService } from './email-change.service';

jest.mock('crypto', () => {
  const actual = jest.requireActual('crypto');
  return { ...actual, randomInt: jest.fn(actual.randomInt) };
});
jest.mock('bcryptjs', () => ({
  hash: jest.fn(async (value: string) => `hashed:${value}`),
  compare: jest.fn(async (value: string, hash: string) => hash === `hashed:${value}`),
}));

const USER = 'u1';
const IP = '10.0.0.1';
const sqlOf = (call: unknown[]) => String(call[0]);
const HAS_EVENT = "kind = $2 AND created_at";

describe('EmailChangeService', () => {
  let query: jest.Mock;
  let manager: { query: jest.Mock; update: jest.Mock };
  let dataSource: { query: jest.Mock; transaction: jest.Mock };
  let mail: { sendEmailChangeCodeEmail: jest.Mock };
  let realtime: { disconnectUser: jest.Mock };
  let service: EmailChangeService;
  let logs: string[];
  /** Respostas por trecho do SQL (a primeira chave que casa vence); o que não casa devolve "nenhuma linha". */
  let routes: Record<string, unknown>;

  const answer = (sql: string) => {
    const key = Object.keys(routes).find((fragment) => sql.includes(fragment));
    return key ? routes[key] : [];
  };

  beforeEach(() => {
    jest.clearAllMocks();
    routes = { "SELECT $1, 'CODE_LOCK'": [], 'AS "lastHour"': [{ lastHour: 0, lastDay: 0 }], 'FROM users WHERE id': [{ email: 'ana@teste.com', password: 'hashed:senha123' }], 'RETURNING id': [{ id: 'r1' }] };
    query = jest.fn(async (sql: string) => answer(sql));
    manager = { query, update: jest.fn() };
    dataSource = { query, transaction: jest.fn(async (callback: (m: unknown) => unknown) => callback(manager)) };
    mail = { sendEmailChangeCodeEmail: jest.fn() };
    realtime = { disconnectUser: jest.fn() };
    service = new EmailChangeService(dataSource as any, mail as any, realtime as any);
    logs = [];
    for (const level of ['log', 'warn', 'error'] as const) jest.spyOn(Logger.prototype, level).mockImplementation((message: unknown) => void logs.push(String(message)));
  });
  afterEach(() => jest.restoreAllMocks());

  const rejection = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error: any) {
      return { status: error.getStatus(), ...error.getResponse() };
    }
    throw new Error('era para recusar');
  };
  const ranSql = (fragment: string) => query.mock.calls.some((call) => sqlOf(call).includes(fragment));

  describe('pedir', () => {
    it('grava só o hash do código (gerado com randomInt) e manda o código ao e-mail novo', async () => {
      const result = await service.request(USER, { newEmail: ' Novo@Teste.com ', currentPassword: 'senha123' }, IP);

      expect(randomInt).toHaveBeenCalledWith(0, 1_000_000);
      const [to, code] = mail.sendEmailChangeCodeEmail.mock.calls[0];
      expect(to).toBe('novo@teste.com');
      expect(code).toMatch(/^\d{6}$/);
      const insert = query.mock.calls.find((call) => sqlOf(call).includes('INSERT INTO email_change_requests'));
      expect(insert[1]).toEqual([USER, 'novo@teste.com', `hashed:${code}`, 5, 30]);
      expect(result).toEqual({ message: 'Enviamos um código para novo@teste.com.', newEmail: 'novo@teste.com', resendInSeconds: 60 });
    });

    it('e-mail igual ao atual em outra caixa: 400 sem conferir a senha', async () => {
      const error = await rejection(service.request(USER, { newEmail: 'ANA@teste.com', currentPassword: 'errada' }, IP));

      expect(error).toMatchObject({ status: 400, code: 'SAME_EMAIL', message: 'Este já é o seu e-mail atual.' });
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it('senha errada: 400, registra a falha e não manda e-mail', async () => {
      routes['AS "failures"'] = [{ failures: 1 }];
      const error = await rejection(service.request(USER, { newEmail: 'novo@teste.com', currentPassword: 'errada' }, IP));

      expect(error).toMatchObject({ status: 400, code: 'WRONG_PASSWORD', message: 'Senha atual incorreta.' });
      expect(ranSql("'PASSWORD_FAILED'")).toBe(true);
      expect(ranSql("'PASSWORD_LOCK'")).toBe(false);
      expect(mail.sendEmailChangeCodeEmail).not.toHaveBeenCalled();
    });

    it('5ª senha errada na hora grava o bloqueio', async () => {
      routes['AS "failures"'] = [{ failures: 5 }];
      await rejection(service.request(USER, { newEmail: 'novo@teste.com', currentPassword: 'errada' }, IP));

      expect(ranSql("'PASSWORD_LOCK'")).toBe(true);
      expect(logs.some((line) => line.includes('email_change.password_locked'))).toBe(true);
    });

    it('bloqueio por senha ativo: 429 mesmo com a senha certa', async () => {
      routes[HAS_EVENT] = [{ one: 1 }];
      const error = await rejection(service.request(USER, { newEmail: 'novo@teste.com', currentPassword: 'senha123' }, IP));

      expect(error).toMatchObject({ status: 429, code: 'PASSWORD_LOCKED', message: 'Muitas tentativas com a senha errada. Tente de novo em 1 hora.' });
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it('e-mail em uso por outra conta: 409, conta no limite e não manda e-mail', async () => {
      routes['lower(email)'] = [{ one: 1 }];
      routes['AS "lastHour"'] = [{ lastHour: 0, lastDay: 0 }];
      const error = await rejection(service.request(USER, { newEmail: 'outro@teste.com', currentPassword: 'senha123' }, IP));

      expect(error).toMatchObject({ status: 409, code: 'EMAIL_IN_USE', message: 'Este e-mail já está em uso.' });
      expect(ranSql("'EMAIL_IN_USE'")).toBe(true);
      expect(ranSql('INSERT INTO email_change_requests')).toBe(false);
      expect(mail.sendEmailChangeCodeEmail).not.toHaveBeenCalled();
    });

    it('cooldown: 429 com retryAfterSeconds', async () => {
      routes['ceil(extract'] = [{ retryAfter: 42 }];
      const error = await rejection(service.request(USER, { newEmail: 'novo@teste.com', currentPassword: 'senha123' }, IP));

      expect(error).toMatchObject({ status: 429, code: 'COOLDOWN', message: 'Aguarde para pedir outro código.', retryAfterSeconds: 42 });
    });

    it.each([
      [{ lastHour: 5, lastDay: 5 }, 'HOURLY_LIMIT', 'Você atingiu o limite de códigos por hora. Tente de novo mais tarde.'],
      [{ lastHour: 2, lastDay: 10 }, 'DAILY_LIMIT', 'Você atingiu o limite de códigos de hoje. Tente de novo amanhã.'],
    ])('limite %j: 429 %s', async (window, code, message) => {
      routes['AS "lastHour"'] = [window];
      const error = await rejection(service.request(USER, { newEmail: 'novo@teste.com', currentPassword: 'senha123' }, IP));

      expect(error).toMatchObject({ status: 429, code, message });
    });

    it('envio falhando: continua 200 e o log não tem código, senha nem e-mail novo', async () => {
      routes['AS "lastHour"'] = [{ lastHour: 0, lastDay: 0 }];
      mail.sendEmailChangeCodeEmail.mockImplementation(async (to: string, code: string) => {
        throw new Error(`SMTP recusou ${to} com ${code}`);
      });
      const result = await service.request(USER, { newEmail: 'novo@teste.com', currentPassword: 'senha123' }, IP);

      expect(result.resendInSeconds).toBe(60);
      const text = logs.join('\n');
      expect(text).not.toContain('novo@teste.com');
      expect(text).not.toContain('senha123');
      expect(text).not.toMatch(/\b\d{6}\b/);
      expect(text).toContain('email_change.requested');
      expect(text).toContain('"emailDomain":"teste.com"');
    });
  });

  describe('confirmar', () => {
    const counted = (attempts: number) => [[{ id: 'r1', codeHash: 'hashed:123456', attempts, newEmail: 'novo@teste.com' }], 1];

    it('código errado devolve as tentativas que restam (singular com 1)', async () => {
      routes['SET attempts'] = counted(4);
      const error = await rejection(service.confirm(USER, '000000', IP));

      expect(error).toMatchObject({ status: 400, code: 'CODE_INVALID', attemptsLeft: 1, message: 'Código incorreto. Você ainda tem 1 tentativa.' });
    });

    it('código errado com mais tentativas usa o plural', async () => {
      routes['SET attempts'] = counted(1);
      const error = await rejection(service.confirm(USER, '000000', IP));

      expect(error).toMatchObject({ code: 'CODE_INVALID', attemptsLeft: 4, message: 'Código incorreto. Você ainda tem 4 tentativas.' });
    });

    it('5ª tentativa errada esgota o código', async () => {
      routes['SET attempts'] = counted(5);
      const error = await rejection(service.confirm(USER, '000000', IP));

      expect(error).toMatchObject({ status: 400, code: 'CODE_EXHAUSTED', message: 'Muitas tentativas com este código. Peça um novo.' });
    });

    it('15ª falha em 24 h bloqueia e responde 429 na mesma resposta', async () => {
      routes['SET attempts'] = counted(5);
      routes["SELECT $1, 'CODE_LOCK'"] = [{ id: 'l1' }];
      const error = await rejection(service.confirm(USER, '000000', IP));

      expect(error).toMatchObject({ status: 429, code: 'CODE_LOCKED' });
      expect(logs.some((line) => line.includes('email_change.locked'))).toBe(true);
    });

    it('código certo troca o e-mail, grava o marco de sessões e derruba o websocket, sem e-mail', async () => {
      routes['SET attempts'] = counted(1);
      routes['SET confirmed_at'] = [[], 1];
      const result = await service.confirm(USER, '123456', IP);

      expect(result).toEqual({ message: 'E-mail alterado. Entre de novo com o novo e-mail.' });
      expect(manager.update).toHaveBeenCalledWith(expect.anything(), { id: USER }, { email: 'novo@teste.com', updatedBy: USER, passwordChangedAt: expect.any(Date) });
      expect(ranSql('UPDATE password_reset_codes')).toBe(true);
      expect(ranSql('UPDATE schedule_access_codes')).toBe(true);
      expect(realtime.disconnectUser).toHaveBeenCalledWith(USER);
      expect(mail.sendEmailChangeCodeEmail).not.toHaveBeenCalled();
    });

    it('e-mail tomado antes da confirmação: 409, nada muda e a sessão continua', async () => {
      routes['SET attempts'] = counted(1);
      routes['lower(email)'] = [{ one: 1 }];
      const error = await rejection(service.confirm(USER, '123456', IP));

      expect(error).toMatchObject({ status: 409, code: 'EMAIL_IN_USE', message: 'Este e-mail passou a ser usado por outra conta. Escolha outro.' });
      expect(manager.update).not.toHaveBeenCalled();
      expect(realtime.disconnectUser).not.toHaveBeenCalled();
    });

    it('violação do índice único (corrida entre duas contas): 409', async () => {
      routes['SET attempts'] = counted(1);
      routes['SET confirmed_at'] = [[], 1];
      manager.update.mockRejectedValue(Object.assign(new Error('duplicate key'), { code: '23505' }));
      const error = await rejection(service.confirm(USER, '123456', IP));

      expect(error).toMatchObject({ status: 409, code: 'EMAIL_IN_USE' });
      expect(realtime.disconnectUser).not.toHaveBeenCalled();
    });

    it('duas confirmações simultâneas: a que não consome o pedido recebe 410', async () => {
      routes['SET attempts'] = counted(1);
      routes['SET confirmed_at'] = [[], 0];
      const error = await rejection(service.confirm(USER, '123456', IP));

      expect(error).toMatchObject({ status: 410, code: 'REQUEST_GONE', message: 'Este pedido de troca não vale mais. Comece de novo.' });
      expect(manager.update).not.toHaveBeenCalled();
    });

    describe('tentativa não contada', () => {
      const setup = (pending: object | null, locked = false) => {
        routes['SET attempts'] = [[], 0];
        routes[HAS_EVENT] = locked ? [{ one: 1 }] : [];
        routes['AS "requestExpired"'] = pending ? [pending] : [];
      };

      it.each([
        ['sem pedido', null, 410, 'REQUEST_GONE'],
        ['pedido vencido (30 min)', { attempts: 0, requestExpired: true, codeExpired: true }, 410, 'REQUEST_GONE'],
        ['código vencido com pedido válido', { attempts: 0, requestExpired: false, codeExpired: true }, 400, 'CODE_EXPIRED'],
        ['código esgotado', { attempts: 5, requestExpired: false, codeExpired: false }, 400, 'CODE_EXHAUSTED'],
      ])('%s', async (_name, pending, status, code) => {
        setup(pending);
        expect(await rejection(service.confirm(USER, '123456', IP))).toMatchObject({ status, code });
      });

      it('conta bloqueada: 429', async () => {
        setup(null, true);
        expect(await rejection(service.confirm(USER, '123456', IP))).toMatchObject({ status: 429, code: 'CODE_LOCKED' });
      });
    });
  });

  describe('reenviar e cancelar', () => {
    it('sem pedido pendente: 410', async () => {
      expect(await rejection(service.resend(USER))).toMatchObject({ status: 410, code: 'REQUEST_GONE' });
    });

    it('com pedido pendente: código novo para o mesmo e-mail, sem senha', async () => {
      const expiresAt = new Date();
      routes['AS "requestExpiresAt"'] = [{ id: 'r1', newEmail: 'novo@teste.com', requestExpiresAt: expiresAt }];
      routes['AS "lastHour"'] = [{ lastHour: 1, lastDay: 1 }];
      const result = await service.resend(USER);

      expect(result).toEqual({ message: 'Enviamos um novo código para novo@teste.com.', newEmail: 'novo@teste.com', resendInSeconds: 60 });
      expect(mail.sendEmailChangeCodeEmail).toHaveBeenCalledWith('novo@teste.com', expect.stringMatching(/^\d{6}$/));
      const insert = query.mock.calls.find((call) => sqlOf(call).includes('INSERT INTO email_change_requests'));
      expect(insert[1][4]).toBe(expiresAt);
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it('cancelar é idempotente', async () => {
      routes['RETURNING id'] = [[], 0];
      expect(await service.cancel(USER)).toEqual({ message: 'Troca de e-mail cancelada.' });
    });
  });
});
