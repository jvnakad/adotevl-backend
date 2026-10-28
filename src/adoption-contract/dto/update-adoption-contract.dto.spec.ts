import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MAX_CLAUSE_LENGTH, UpdateAdoptionContractDto } from './update-adoption-contract.dto';

const clause = (overrides: Record<string, unknown> = {}) => ({ key: 'multa', order: 1, content: 'Texto da multa.', removed: false, ...overrides });

const messagesOf = async (payload: Record<string, unknown>) => {
  const errors = await validate(plainToInstance(UpdateAdoptionContractDto, payload));
  const collect = (list: typeof errors): string[] => list.flatMap((error) => [...Object.values(error.constraints ?? {}), ...collect(error.children ?? [])]);
  return collect(errors);
};

describe('UpdateAdoptionContractDto', () => {
  it('aceita payload vazio (tudo opcional)', async () => {
    expect(await messagesOf({})).toEqual([]);
  });

  it('aceita pet, dados e cláusulas válidos', async () => {
    expect(
      await messagesOf({
        data: { adopter: { name: 'Maria' } },
        clauses: [clause(), clause({ key: 'entrega', order: 2, removed: true })],
      }),
    ).toEqual([]);
  });

  it('recusa dados que não são objeto', async () => {
    expect(await messagesOf({ data: 'texto' })).toEqual(expect.arrayContaining(['Dados do termo de adoção inválidos.']));
  });

  it('cláusulas precisam ser uma lista', async () => {
    expect(await messagesOf({ clauses: 'multa' })).toContain('Cláusulas devem ser uma lista.');
  });

  it('valida cada cláusula com mensagens em PT-BR', async () => {
    const messages = await messagesOf({ clauses: [{ key: 1, order: 1.5, content: null, removed: 'sim' }] });

    expect(messages).toEqual(
      expect.arrayContaining([
        'Chave da cláusula inválida.',
        'Ordem da cláusula deve ser um número inteiro.',
        'Texto da cláusula inválido.',
        'Informe se a cláusula foi removida (true ou false).',
      ]),
    );
  });

  it(`limita o texto da cláusula a ${MAX_CLAUSE_LENGTH} caracteres`, async () => {
    expect(await messagesOf({ clauses: [clause({ content: 'a'.repeat(MAX_CLAUSE_LENGTH) })] })).toEqual([]);
    expect(await messagesOf({ clauses: [clause({ content: 'a'.repeat(MAX_CLAUSE_LENGTH + 1) })] })).toContain(
      `Texto da cláusula deve ter no máximo ${MAX_CLAUSE_LENGTH} caracteres.`,
    );
  });
});
