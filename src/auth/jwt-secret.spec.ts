import { jwtSecret } from './jwt-secret';

describe('jwtSecret', () => {
  const env = { ...process.env };
  const STRONG = 'k9Qz3vLw8RtYp2NxA6mBcD4eFgHjUs7V';

  beforeEach(() => {
    process.env.NODE_ENV = 'production';
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it('sobe com exatamente 15 caracteres', () => {
    process.env.JWT_SECRET = STRONG.slice(0, 15);

    expect(jwtSecret()).toBe(STRONG.slice(0, 15));
  });

  it('sobe com 15 ou mais caracteres', () => {
    process.env.JWT_SECRET = STRONG;

    expect(jwtSecret()).toBe(STRONG);
  });

  it.each([
    ['ausente', undefined],
    ['vazio', ''],
    ['changeme', 'changeme'],
    ['sua_chave_secreta', 'sua_chave_secreta'],
    ['com 14 caracteres', STRONG.slice(0, 14)],
  ])('recusa segredo %s com a mensagem fixa', (_label, value) => {
    if (value === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = value;

    expect(() => jwtSecret()).toThrow('JWT_SECRET ausente ou fraco.');
  });

  it.each(['dev-secret-local-adotevl-0123456789abcdef', 'ci-secret-0123456789abcdef0123456789abcdef', 'unit-test-secret'])(
    'recusa o valor público do repositório "%s" fora de NODE_ENV=test',
    (value) => {
      process.env.JWT_SECRET = value;

      expect(() => jwtSecret()).toThrow('JWT_SECRET ausente ou fraco.');
    },
  );

  it('não mostra o valor do segredo na mensagem de erro', () => {
    process.env.JWT_SECRET = 'curto-demais';

    expect(() => jwtSecret()).toThrow(expect.objectContaining({ message: expect.not.stringContaining('curto-demais') }));
  });

  it('em NODE_ENV=test aceita segredo curto, mas ainda exige que exista', () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret';
    expect(jwtSecret()).toBe('test-secret');

    delete process.env.JWT_SECRET;
    expect(() => jwtSecret()).toThrow('JWT_SECRET ausente ou fraco.');
  });
});
