import 'reflect-metadata';
import { instanceToPlain, plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateProductTypeDto } from './create-product-type.dto';
import { CreateProductDto, UpdateProductDto } from './create-product.dto';
import { FindStockProductsDto } from './find-stock-products.dto';
import { FindStockHistoryDto } from './find-stock-history.dto';

const messages = async (cls: any, payload: object) => {
  const errors = await validate(plainToInstance(cls, payload) as object);
  return errors.flatMap((error) => Object.values(error.constraints ?? {}));
};

const validProduct = { name: 'Ração Premium', productTypeId: '3f0c2b1e-6a52-4f0e-9a43-0f6f4b7a1c11', unit: 'KG', quantity: '10.500' };

describe('CreateProductTypeDto', () => {
  it('normaliza espaços do nome', async () => {
    const dto = plainToInstance(CreateProductTypeDto, { name: '  Produto   de  limpeza  ' });
    expect(dto.name).toBe('Produto de limpeza');
    expect(await validate(dto)).toHaveLength(0);
  });

  it.each([{}, { name: '' }, { name: '   ' }, { name: 123 }])('recusa nome ausente, vazio ou inválido (%j)', async (payload) => {
    expect(await messages(CreateProductTypeDto, payload)).toContain('Informe o nome do tipo.');
  });

  it('limite de 250 caracteres vale depois da normalização', async () => {
    expect(await messages(CreateProductTypeDto, { name: `${'a'.repeat(125)}     ${'b'.repeat(124)}` })).toEqual([]); // 250 com um espaço
    expect(await messages(CreateProductTypeDto, { name: 'a'.repeat(251) })).toContain('O nome pode ter até 250 caracteres.');
  });
});

describe('mensagem do nome', () => {
  it('nome ausente devolve uma única mensagem de obrigatório, sem a de tamanho', async () => {
    expect(await messages(CreateProductDto, { ...validProduct, name: undefined })).toEqual(['Informe o nome do produto.']);
    expect(await messages(CreateProductTypeDto, {})).toEqual(['Informe o nome do tipo.']);
    expect(await messages(CreateProductTypeDto, { name: '   ' })).toEqual(['Informe o nome do tipo.']);
    expect(await messages(CreateProductDto, { ...validProduct, name: null })).toEqual(['Informe o nome do produto.']);
  });

  it('nome longo devolve só a mensagem de tamanho', async () => {
    expect(await messages(CreateProductDto, { ...validProduct, name: 'a'.repeat(251) })).toEqual(['O nome pode ter até 250 caracteres.']);
    expect(await messages(CreateProductTypeDto, { name: 'a'.repeat(251) })).toEqual(['O nome pode ter até 250 caracteres.']);
  });
});

describe('caracteres inválidos', () => {
  const invalidNames = [
    ['controle U+0007', 'a\u0007b'],
    ['DEL U+007F', 'a\u007fb'],
    ['NUL U+0000', 'a\u0000b'],
    ['bidi U+202E', 'abc\u202Edef'],
    ['bidi isolate U+2066', '\u2066abc'],
    ['largura zero U+200B', 'a\u200Bb'],
    ['marca LRM U+200E', 'a\u200Eb'],
    ['soft hyphen U+00AD', 'a\u00ADb'],
    ['ZWJ solto entre letras', 'a\u200Db'],
    ['ZWJ no começo', '\u200D🐶'],
    ['ZWJ no fim', '🐶\u200D'],
    ['ZWJ entre emoji e letra', '🐶\u200Db'],
    ['ZWNJ U+200C', 'a\u200Cb'],
    ['RLO U+202E antes de texto', '\u202Eabc'],
    ['LRM/RLM U+200F', 'a\u200Fb'],
  ];

  it.each(invalidNames)('nome com %s é recusado no produto e no tipo', async (_label, name) => {
    expect(await messages(CreateProductDto, { ...validProduct, name })).toEqual(['O nome contém caracteres inválidos.']);
    expect(await messages(CreateProductTypeDto, { name })).toEqual(['O nome contém caracteres inválidos.']);
  });

  it('tab e quebra de linha viram espaço na normalização e não são recusados', async () => {
    const dto = plainToInstance(CreateProductTypeDto, { name: 'Água\tSanitária\nPet' });
    expect(dto.name).toBe('Água Sanitária Pet');
    expect(await validate(dto)).toHaveLength(0);
  });

  it.each(['Ração 🐶', '👨\u200D👩\u200D👧', '🏳\uFE0F\u200D🌈', '🏳️‍🌈', '👨‍👩‍👧', '❤\uFE0F', 'Família 👨\u200D👩\u200D👧\u200D👦 grande', 'Petisco 🍖 grande', 'Pão-de-Açúcar', 'Ñandú', '日本語', 'عربى'])('nome com texto legítimo é aceito: %s', async (name) => {
    expect(await messages(CreateProductDto, { ...validProduct, name })).toEqual([]);
  });

  it('observações: recusa NUL e controles, aceita quebra de linha, retorno e tabulação, emoji e largura zero', async () => {
    for (const notes of ['a\u0000b', 'a\u0007b', 'a\u007fb', 'a\u001bb']) {
      expect(await messages(CreateProductDto, { ...validProduct, notes })).toEqual(['As observações contêm caracteres inválidos.']);
    }
    for (const notes of ['linha 1\nlinha 2', 'a\r\nb', 'col1\tcol2', 'Ração 🐶', 'texto\u200Bcom largura zero']) {
      expect(await messages(CreateProductDto, { ...validProduct, notes })).toEqual([]);
    }
  });
});

describe('CreateProductDto', () => {
  it('aceita um produto válido, com opcionais ausentes', async () => {
    expect(await messages(CreateProductDto, validProduct)).toEqual([]);
  });

  it('recusa cada campo obrigatório faltante com a mensagem do campo', async () => {
    const result = await messages(CreateProductDto, {});
    expect(result).toEqual(
      expect.arrayContaining(['Informe o nome do produto.', 'Escolha o tipo de produto.', 'Escolha a unidade de medida.', 'Informe a quantidade.']),
    );
  });

  it('recusa unidade fora do enum e tipo que não é UUID', async () => {
    const result = await messages(CreateProductDto, { ...validProduct, unit: 'GRAMA', productTypeId: 'abc' });
    expect(result).toEqual(expect.arrayContaining(['Escolha a unidade de medida.', 'Escolha o tipo de produto.']));
  });

  it.each(['2026-02-31', '31/12/2026', 'ontem', 20261231])('recusa vencimento inválido (%j)', async (expirationDate) => {
    expect(await messages(CreateProductDto, { ...validProduct, expirationDate })).toContain('Informe uma data válida.');
  });

  it('aceita vencimento válido, no passado inclusive, e null', async () => {
    expect(await messages(CreateProductDto, { ...validProduct, expirationDate: '2020-01-01' })).toEqual([]);
    expect(await messages(CreateProductDto, { ...validProduct, expirationDate: null })).toEqual([]);
  });

  it('observações: aparadas, vazias viram null e passam de 1000 são recusadas', async () => {
    expect(plainToInstance(CreateProductDto, { ...validProduct, notes: '   ' }).notes).toBeNull();
    expect(plainToInstance(CreateProductDto, { ...validProduct, notes: '  oi  ' }).notes).toBe('oi');
    expect(await messages(CreateProductDto, { ...validProduct, notes: 'a'.repeat(1000) })).toEqual([]);
    expect(await messages(CreateProductDto, { ...validProduct, notes: 'a'.repeat(1001) })).toContain('As observações podem ter até 1.000 caracteres.');
  });

  it('mantém a quantidade como veio (a validação é do service) e preserva o campo no whitelist', () => {
    const plain = instanceToPlain(plainToInstance(CreateProductDto, { ...validProduct, quantity: 2.5 }));
    expect(plain.quantity).toBe(2.5);
  });
});

describe('UpdateProductDto', () => {
  it('aceita corpo vazio e campos isolados', async () => {
    expect(await messages(UpdateProductDto, {})).toEqual([]);
    expect(await messages(UpdateProductDto, { quantity: '3' })).toEqual([]);
    expect(await messages(UpdateProductDto, { expirationDate: null, notes: null })).toEqual([]);
  });

  it('valida os campos enviados', async () => {
    const result = await messages(UpdateProductDto, { name: '   ', unit: 'X', expirationDate: '2026-02-31' });
    expect(result).toEqual(expect.arrayContaining(['Informe o nome do produto.', 'Escolha a unidade de medida.', 'Informe uma data válida.']));
  });
});

describe('filtros', () => {
  it('produtos: período e tipo inválidos', async () => {
    const result = await messages(FindStockProductsDto, { from: '10/10/2026', to: '2026-02-31', productTypeId: 'x' });
    expect(result).toEqual(
      expect.arrayContaining(['Data inicial deve estar no formato YYYY-MM-DD.', 'Data final deve estar no formato YYYY-MM-DD.', 'Tipo de produto inválido.']),
    );
  });

  it('histórico: tipo de evento, usuário e busca', async () => {
    const result = await messages(FindStockHistoryDto, { type: 'OUTRO', userId: 'x', search: 'a'.repeat(151) });
    expect(result).toEqual(expect.arrayContaining(['Tipo de evento inválido.', 'Usuário inválido.', 'Busca deve ter no máximo 150 caracteres.']));
    expect(await messages(FindStockHistoryDto, { type: 'TIPO_RENOMEADO', limit: '500' })).toEqual([]);
  });

  it('search repetido (array) devolve mensagem em PT-BR', async () => {
    expect(await messages(FindStockProductsDto, { search: ['a', 'b'] })).toEqual(['Busca deve ser um texto.']);
    expect(await messages(FindStockHistoryDto, { search: ['a', 'b'] })).toEqual(['Busca deve ser um texto.']);
  });

  it('limit acima de 100 é limitado a 100 também nestas listagens', () => {
    expect(plainToInstance(FindStockHistoryDto, { limit: '500' }).limit).toBe(100);
    expect(plainToInstance(FindStockProductsDto, { limit: '101' }).limit).toBe(100);
  });
});
