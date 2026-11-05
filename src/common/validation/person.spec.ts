import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  IsCpf,
  IsFullName,
  IsPersonEmail,
  PERSON_MESSAGES as M,
  isValidCpf,
  normalizeCpf,
  normalizeEmail,
  normalizePersonName,
  validateCpf,
  validateEmail,
  validateFullName,
} from './person';

describe('nome completo', () => {
  it('normaliza espaços nas pontas e no meio', () => {
    expect(normalizePersonName('  Maria   da  Silva ')).toBe('Maria da Silva');
  });

  it.each(['Maria Silva', 'Maria da Silva', 'João D’Ávila', "Ana d'Arc Souza", 'Ana-Clara Lima', 'José dos Santos e Silva', 'Li Wu'])(
    'aceita %s',
    (name) => expect(validateFullName(name)).toBeNull(),
  );

  it.each([undefined, null, '', 123])('exige o nome (%p)', (v) => expect(validateFullName(v)).toBe(M.nameRequired));

  it.each(['Maria 2 Silva', 'Maria S1lva', 'Maria_Silva Souza', 'Maria. Silva', 'Maria @ Silva'])('rejeita caracteres inválidos em %s', (n) =>
    expect(validateFullName(n)).toBe(M.nameLetters),
  );

  it.each(['Maria', 'A Silva', 'Maria S', 'Maria d'])('exige nome e sobrenome em %s', (n) =>
    expect(validateFullName(n)).toBe(M.nameSurname),
  );

  it('limita a 120 caracteres', () => {
    const ok = `Maria ${'a'.repeat(114)}`;
    expect(ok).toHaveLength(120);
    expect(validateFullName(ok)).toBeNull();
    expect(validateFullName(`${ok}a`)).toBe(M.nameMax);
  });
});

describe('e-mail', () => {
  it('normaliza com trim e minúsculas', () => {
    expect(normalizeEmail('  Maria@Exemplo.COM ')).toBe('maria@exemplo.com');
  });

  it.each(['nome@exemplo.com', 'a.b+tag@sub.exemplo.com.br', 'x@y.co'])('aceita %s', (e) => expect(validateEmail(e)).toBeNull());

  it.each([undefined, null, ''])('exige o e-mail (%p)', (v) => expect(validateEmail(v)).toBe(M.emailRequired));

  it.each(['semarroba.com', 'a@@b.com', 'a@b@c.com', 'a b@c.com', 'a@b', 'a@b.c', 'a@b.123', 'a..b@c.com', 'a@b..com', '@c.com', 'a@.com', 'a@-b.com', `${'a'.repeat(250)}@b.com`])(
    'rejeita %s',
    (e) => expect(validateEmail(e)).toBe(M.emailInvalid),
  );
});

describe('CPF', () => {
  it('normaliza para só dígitos', () => {
    expect(normalizeCpf('529.982.247-25')).toBe('52998224725');
  });

  it.each(['52998224725', '11144477735', '12345678909', '39053344705'])('isValidCpf aceita %s', (c) => expect(isValidCpf(c)).toBe(true));

  it.each([
    ['1º dígito errado', '52998224735'],
    ['2º dígito errado', '52998224726'],
    ['zeros', '00000000000'],
    ['sequência 123456789-00', '12345678900'],
    ['todos iguais', '11111111111'],
    ['curto', '5299822472'],
    ['longo', '529982247250'],
    ['com máscara (não normalizado)', '529.982.247-25'],
  ])('isValidCpf rejeita: %s', (_label, cpf) => expect(isValidCpf(cpf)).toBe(false));

  it('mensagens por tipo de erro', () => {
    expect(validateCpf('')).toBe(M.cpfRequired);
    expect(validateCpf(undefined)).toBe(M.cpfRequired);
    expect(validateCpf('123')).toBe(M.cpfLength);
    expect(validateCpf('00000000000')).toBe(M.cpfInvalid);
    expect(validateCpf('12345678900')).toBe(M.cpfInvalid);
    expect(validateCpf('52998224735')).toBe(M.cpfInvalid);
    expect(validateCpf('52998224725')).toBeNull();
  });
});

describe('decorators', () => {
  class Dto {
    @IsFullName() fullName: string;
    @IsPersonEmail() email: string;
    @IsCpf() cpf: string;
    @IsFullName({ optional: true }) guardianName?: string;
  }
  const run = async (plain: object) => {
    const dto = plainToInstance(Dto, plain);
    const errors = await validate(dto);
    return { dto, messages: errors.flatMap((e) => Object.values(e.constraints ?? {})) };
  };

  it('valida e normaliza payload correto', async () => {
    const { dto, messages } = await run({ fullName: '  Maria  da Silva ', email: ' Maria@Teste.com ', cpf: '529.982.247-25', guardianName: '' });
    expect(messages).toEqual([]);
    expect(dto).toMatchObject({ fullName: 'Maria da Silva', email: 'maria@teste.com', cpf: '52998224725' });
    expect(dto.guardianName).toBeUndefined();
  });

  it('devolve as mensagens exatas', async () => {
    const { messages } = await run({ fullName: 'Maria', email: 'x', cpf: '123', guardianName: 'Jo' });
    expect(messages.sort()).toEqual([M.cpfLength, M.emailInvalid, M.nameSurname, M.nameSurname].sort());
  });

  it('nome do responsável vazio usa a mensagem própria; demais regras são as do nome', async () => {
    class G {
      @IsFullName({ optional: true, requiredMessage: M.guardianNameRequired }) guardianName?: string;
    }
    const msgs = async (v: unknown) =>
      (await validate(plainToInstance(G, { guardianName: v }))).flatMap((e) => Object.values(e.constraints ?? {}));
    expect(await msgs('   ')).toEqual([M.guardianNameRequired]);
    expect(await msgs('Ana')).toEqual([M.nameSurname]);
    expect(await msgs(undefined)).toEqual([]);
    expect(await msgs('Ana Souza')).toEqual([]);
  });

  it('campos ausentes pedem o preenchimento', async () => {
    const { messages } = await run({});
    expect(messages.sort()).toEqual([M.cpfRequired, M.emailRequired, M.nameRequired].sort());
  });
});
