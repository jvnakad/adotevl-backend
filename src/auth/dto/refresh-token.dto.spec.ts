import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RefreshTokenDto } from './refresh-token.dto';

const messages = async (body: unknown) => (await validate(plainToInstance(RefreshTokenDto, body))).flatMap((e) => Object.values(e.constraints ?? {}));
const VALID = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U-_';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.assinaturaassinaturaassinatura';

describe('RefreshTokenDto', () => {
  it('aceita 43 caracteres base64url', async () => {
    expect(VALID).toHaveLength(43);
    expect(await messages({ refreshToken: VALID })).toEqual([]);
  });

  it.each([
    ['ausente', {}],
    ['null', { refreshToken: null }],
    ['número', { refreshToken: 123 }],
    ['objeto', { refreshToken: { $ne: '' } }],
    ['lista', { refreshToken: [VALID] }],
    ['vazio', { refreshToken: '' }],
    ['42 caracteres', { refreshToken: VALID.slice(0, 42) }],
    ['44 caracteres', { refreshToken: `${VALID}A` }],
    ['513 caracteres', { refreshToken: 'A'.repeat(513) }],
    ['caractere fora do conjunto', { refreshToken: `${VALID.slice(0, 42)}+` }],
    ['espaço no fim', { refreshToken: `${VALID.slice(0, 42)} ` }],
    ['quebra de linha no fim', { refreshToken: `${VALID}\n` }],
    ['um JWT (tem ponto)', { refreshToken: JWT }],
  ])('recusa %s com 400 e sem repetir o valor', async (_label, body) => {
    const result = await messages(body);

    expect(result.length).toBeGreaterThan(0);
    const value = (body as any).refreshToken;
    if (typeof value === 'string' && value.length > 1) for (const message of result) expect(message).not.toContain(value);
    for (const message of result) expect(['Informe o token de renovação.', 'Token de renovação inválido.']).toContain(message);
  });
});
