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
  const INVALID = ['O nome contém caracteres inválidos.'];
  const EMOJI = ['O nome não pode conter emojis.'];
  const invalidNames = [
    ['controle U+0007', 'a\u0007b'],
    ['DEL U+007F', 'a\u007fb'],
    ['NUL U+0000', 'a\u0000b'],
    ['bidi U+202E', 'abc\u202Edef'],
    ['bidi isolate U+2066', '\u2066abc'],
    ['largura zero U+200B', 'a\u200Bb'],
    ['marca LRM U+200E', 'a\u200Eb'],
    ['marca RLM U+200F', 'a\u200Fb'],
    ['soft hyphen U+00AD', 'a\u00ADb'],
    ['ZWJ solto entre letras', 'a\u200Db'],
    ['ZWJ no começo', '\u200Dabc'],
    ['ZWNJ U+200C', 'a\u200Cb'],
  ];

  it.each(invalidNames)('nome com %s é recusado no produto e no tipo', async (_label, name) => {
    expect(await messages(CreateProductDto, { ...validProduct, name })).toEqual(INVALID);
    expect(await messages(CreateProductTypeDto, { name })).toEqual(INVALID);
  });

  const emojiNames = [
    ['emoji simples', 'Ração 🐶'],
    ['emoji com tom de pele e ZWJ (👩🏽‍💻)', '\u{1F469}\u{1F3FD}\u200D\u{1F4BB}'],
    ['bandeira com tags (🏴󠁧󠁢󠁥󠁮󠁧󠁿)', '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}'],
    ['família com ZWJ (👨‍👩‍👧)', '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}'],
    ['coração com seletor (❤️)', '\u2764\uFE0F'],
    ['bandeira do Brasil (🇧🇷)', '\u{1F1E7}\u{1F1F7}'],
    ['keycap (1️⃣)', '1\uFE0F\u20E3'],
    ['arco-íris com ZWJ (🏳️‍🌈)', '\u{1F3F3}\uFE0F\u200D\u{1F308}'],
    ['só o tom de pele', 'a\u{1F3FD}b'],
    ['seletor U+FE0F solto', 'a\uFE0Fb'],
    ['keycap U+20E3 solto', 'a\u20E3b'],
    ['© com seletor de emoji', '\u00A9\uFE0F'],
    ['® com seletor de emoji', '\u00AE\uFE0F'],
    ['™ com seletor de emoji', 'Marca\u2122\uFE0F'],
  ];

  it.each(emojiNames)('nome com %s é recusado com a mensagem de emoji', async (_label, name) => {
    expect(await messages(CreateProductDto, { ...validProduct, name })).toEqual(EMOJI);
    expect(await messages(CreateProductTypeDto, { name })).toEqual(EMOJI);
  });

  it('no nome, tab, \n e \r viram espaço na normalização (antes da checagem de controle) e não são recusados', async () => {
    for (const [input, expected] of [
      ['Água\tSanitária\nPet', 'Água Sanitária Pet'],
      ['Ração\r\nPremium', 'Ração Premium'],
      ['\r\n Ração \t', 'Ração'],
      ['A\r\r\nB', 'A B'],
    ]) {
      const type = plainToInstance(CreateProductTypeDto, { name: input });
      const product = plainToInstance(CreateProductDto, { ...validProduct, name: input });
      expect([type.name, product.name]).toEqual([expected, expected]);
      expect(await validate(type)).toHaveLength(0);
      expect(await validate(product)).toHaveLength(0);
    }
  });

  it('observações: a limpeza dos controles acontece antes do limite de 1000 caracteres', async () => {
    const valid = async (notes: string) => (await validate(plainToInstance(CreateProductDto, { ...validProduct, notes }))).length;
    // 1000 caracteres úteis + controles que seriam passados do limite: aceito
    expect(await valid('a'.repeat(1000) + '\u0007'.repeat(50))).toBe(0);
    expect(await valid('\u0000'.repeat(10) + 'a'.repeat(1000))).toBe(0);
    // 1001 úteis continuam recusados
    expect(await valid('a'.repeat(1001) + '\u0007')).toBe(1);
    // \n, \r e \t contam como caracteres
    expect(await valid('a'.repeat(500) + '\n' + 'a'.repeat(500))).toBe(1);
  });

  it.each(['Ração 10kg #2', 'Pão-de-Açúcar', 'Ñandú', '日本語', 'عربى', 'Item 1*', '100% natural', 'A/B_c (2)', 'Shampoo Pet®', 'Marca™', '© 2026', 'a©b®™'])('nome legítimo é aceito: %s', async (name) => {
    expect(await messages(CreateProductDto, { ...validProduct, name })).toEqual([]);
    expect(await messages(CreateProductTypeDto, { name })).toEqual([]);
  });

  it('observações: remove controles em silêncio (sem erro), preservando \n, \r e \t, emoji e largura zero', async () => {
    const notes = async (value: string) => {
      const dto = plainToInstance(CreateProductDto, { ...validProduct, notes: value });
      expect(await validate(dto)).toHaveLength(0);
      return dto.notes;
    };
    expect(await notes('a\u0000b')).toBe('ab');
    expect(await notes('a\u0007b\u007Fc\u0085d\u001Be')).toBe('abcde');
    expect(await notes('linha 1\nlinha 2')).toBe('linha 1\nlinha 2');
    expect(await notes('a\r\nb')).toBe('a\r\nb');
    expect(await notes('col1\tcol2')).toBe('col1\tcol2');
    expect(await notes('Ração \u{1F436}')).toBe('Ração \u{1F436}');
    expect(await notes('texto\u200Bcom largura zero')).toBe('texto\u200Bcom largura zero');
    expect(await notes('\u0007\u0000')).toBeNull(); // só controles = vazio
    expect(await notes('  \u0007 oi \u0000 ')).toBe('oi');
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
