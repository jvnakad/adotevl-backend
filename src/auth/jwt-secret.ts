/** Valores de exemplo que já circularam em .env/README: nunca valem como segredo. */
const WEAK_SECRETS = [
  'changeme',
  'sua_chave_secreta',
  // Valores públicos do repositório (.env.local.example, CI e testes unitários)
  'dev-secret-local-adotevl-0123456789abcdef',
  'ci-secret-0123456789abcdef0123456789abcdef',
  'unit-test-secret',
];
const MIN_SECRET_LENGTH = 15;

/**
 * Segredo do JWT. Sem fallback: ausente, de exemplo ou com menos de 15 caracteres derruba o boot (RN-37).
 * Em NODE_ENV=test só exige que exista (os testes usam segredos curtos).
 */
export function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'test' && secret) return secret;
  if (!secret || WEAK_SECRETS.includes(secret) || secret.length < MIN_SECRET_LENGTH) {
    // Nunca inclui o valor na mensagem
    throw new Error('JWT_SECRET ausente ou fraco.');
  }
  return secret;
}
