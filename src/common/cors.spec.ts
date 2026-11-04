import { allowedOrigins, corsOrigin } from './cors';

const allowed = (origin?: string) => {
  let result: boolean | undefined;
  corsOrigin(origin, (_error, allow) => (result = allow));
  return result;
};

describe('allowedOrigins', () => {
  afterEach(() => delete process.env.CORS_ORIGINS);

  it('lê a lista separada por vírgula, sem espaços nem barra final', () => {
    expect(allowedOrigins(' https://adoteapp.netlify.app/ ,https://www.adotevl.org,')).toEqual([
      'https://adoteapp.netlify.app',
      'https://www.adotevl.org',
    ]);
  });

  it('sem a variável (ou vazia), não restringe', () => {
    expect(allowedOrigins(undefined)).toBeNull();
    expect(allowedOrigins(' , ')).toBeNull();
    expect(allowed('https://qualquer.site')).toBe(true);
  });

  it('com a lista, libera só origens dela e pedidos sem Origin', () => {
    process.env.CORS_ORIGINS = 'https://adoteapp.netlify.app';
    expect(allowed('https://adoteapp.netlify.app')).toBe(true);
    expect(allowed('https://evil.netlify.app')).toBe(false);
    expect(allowed(undefined)).toBe(true);
  });
});
