import { allowedOrigins, corsOptions, corsOrigin, LOCAL_ORIGINS } from './cors';

const allowed = (origin?: string) => {
  let result: boolean | undefined;
  corsOrigin(origin, (_error, allow) => (result = allow));
  return result;
};

describe('cors', () => {
  afterEach(() => delete process.env.CORS_ORIGINS);

  it('lê a lista separada por vírgula, sem espaços nem barra final', () => {
    expect(allowedOrigins(' https://app.adotevl.org/ ,https://lp-adoteapp.netlify.app,')).toEqual([
      'https://app.adotevl.org',
      'https://lp-adoteapp.netlify.app',
    ]);
  });

  it('sem a variável (ou vazia), libera só o ambiente local', () => {
    expect(allowedOrigins(undefined)).toEqual(LOCAL_ORIGINS);
    expect(allowedOrigins(' , ')).toEqual(LOCAL_ORIGINS);
    expect(allowed('http://localhost:5173')).toBe(true);
    expect(allowed('https://qualquer.site')).toBe(false);
  });

  it('com a lista, libera só origens dela e pedidos sem Origin', () => {
    process.env.CORS_ORIGINS = 'https://app.adotevl.org';
    expect(allowed('https://app.adotevl.org')).toBe(true);
    expect(allowed('https://evil.netlify.app')).toBe(false);
    expect(allowed('http://localhost:5173')).toBe(false);
    expect(allowed(undefined)).toBe(true);
  });

  it('liga credenciais sem nunca usar "*"', () => {
    expect(corsOptions).toEqual({ origin: corsOrigin, credentials: true });
  });
});
