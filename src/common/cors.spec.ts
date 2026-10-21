import { allowedOrigins, corsOrigin, LOCAL_ORIGINS } from './cors';

describe('allowedOrigins', () => {
  it('lê a lista separada por vírgula, sem espaços nem barra final', () => {
    expect(allowedOrigins(' https://adoteapp.netlify.app/ ,https://www.adotevl.org,')).toEqual([
      'https://adoteapp.netlify.app',
      'https://www.adotevl.org',
    ]);
  });

  it('sem a variável (ou vazia), libera só o ambiente local', () => {
    expect(allowedOrigins(undefined)).toEqual(LOCAL_ORIGINS);
    expect(allowedOrigins(' , ')).toEqual(LOCAL_ORIGINS);
  });

  it('corsOrigin libera só origens da lista e pedidos sem Origin', () => {
    process.env.CORS_ORIGINS = 'https://adoteapp.netlify.app';
    const allowed = (origin?: string) => {
      let result: boolean | undefined;
      corsOrigin(origin, (_error, allow) => (result = allow));
      return result;
    };
    expect(allowed('https://adoteapp.netlify.app')).toBe(true);
    expect(allowed('https://evil.netlify.app')).toBe(false);
    expect(allowed(undefined)).toBe(true);
    delete process.env.CORS_ORIGINS;
  });
});
