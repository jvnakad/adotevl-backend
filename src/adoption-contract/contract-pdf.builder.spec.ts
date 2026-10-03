import { buildContractDocDefinition, buildContractPdf, formatLongDatePt, loadImageAsDataUrl, toAutentiquePosition } from './contract-pdf.builder';
import { numberClauses } from './contract-numbering';
import { CONTRACT_TEMPLATE } from './contract-template';
import { emptyContractData } from './contract-data';

const clauses = () =>
  numberClauses(CONTRACT_TEMPLATE.map((clause, index) => ({ key: clause.key, order: index + 1, content: clause.content, originalContent: clause.content, removed: false }))).clauses;

const data = () => {
  const base = emptyContractData();
  base.adopter.name = 'Maria da Silva';
  base.adopter.cpf = '52998224725';
  base.animal.name = 'Rex';
  base.animal.castrated = true;
  return base;
};

// Varre o docDefinition atrás dos textos (para conferir o conteúdo sem abrir o PDF)
const collectText = (node: any): string => {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(collectText).join(' ');
  if (typeof node === 'object') return ['text', 'stack', 'columns'].map((key) => collectText(node[key])).join(' ');
  return '';
};

// Texto com espaços normalizados (os trechos entram separados por espaço)
const flatText = (node: any) => collectText(node).replace(/\s+/g, ' ');

describe('contract-pdf.builder', () => {
  it('gera um Buffer de PDF e a posição da assinatura do adotante na última página', async () => {
    const { buffer, adopterSignature } = await buildContractPdf({ data: data(), clauses: clauses() });

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
    const pages = (buffer.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(adopterSignature.page).toBe(pages);
    expect(adopterSignature.x).toBe(62.99);
    expect(adopterSignature.y).toBeGreaterThan(0);
    expect(adopterSignature.y).toBeLessThan(100);
  }, 30000);

  it('converte a linha do ADOTANTE no ponto do carimbo do Autentique (centralizado, logo acima da linha)', () => {
    // Coluna direita: 60 + 222,64 + 30 + 111,32 → centro em 423,96 pt; carimbo de 98 x 28 pt
    expect(toAutentiquePosition(4, 287.39)).toEqual({ page: 4, x: 62.99, y: 30.81 });
    // Linha no topo da página não gera y negativo
    expect(toAutentiquePosition(2, 10).y).toBe(0);
  });

  it('monta cabeçalhos numerados, dados do animal e campos vazios com linha', () => {
    const definition = buildContractDocDefinition({ data: data(), clauses: clauses() });
    const text = collectText(definition.content);

    expect(text).toContain('CLÁUSULA PRIMEIRA: ');
    expect(text).toContain('CLÁUSULA DÉCIMA QUARTA: ');
    expect(text).toContain('Maria da Silva');
    expect(text).toContain('529.982.247-25');
    expect(text).toContain('(X) SIM  ( ) NÃO');
    expect(text).toContain('______');
    expect(text).toContain('Curitiba/PR, ________ de');
  });

  it('inclui a foto do pet só quando informada', () => {
    const photo = 'data:image/png;base64,AAAA';
    const withPhoto = JSON.stringify(buildContractDocDefinition({ data: data(), clauses: clauses(), petPhoto: photo }).content);
    const withoutPhoto = JSON.stringify(buildContractDocDefinition({ data: data(), clauses: clauses() }).content);

    expect(withPhoto).toContain(photo);
    expect(withoutPhoto).not.toContain('"image"');
  });

  it('formata a data da assinatura por extenso', () => {
    expect(formatLongDatePt('2026-10-02')).toBe('02 de outubro de 2026');
    expect(formatLongDatePt(null)).toBeNull();
  });

  describe('dados do adotante e do animal', () => {
    const fullData = () => {
      const base = data();
      base.adopter = {
        ...base.adopter,
        birthDate: '1990-05-10',
        phone: '41987654321',
        email: 'maria@teste.com',
        rg: '12.345.678-9',
      };
      base.animal = {
        ...base.animal,
        species: 'FELINA',
        sex: 'FEMEA',
        castrated: false,
        vaccinated: null,
        usesMedication: true,
        medicationDetails: '  Antibiótico 2x ao dia ',
      };
      base.signature = { city: 'Londrina/PR', date: '2026-10-02' };
      return base;
    };

    it('formata data de nascimento, telefone celular e CPF', () => {
      const text = flatText(buildContractDocDefinition({ data: fullData(), clauses: clauses() }).content);

      expect(text).toContain('10/05/1990');
      expect(text).toContain('(41) 98765-4321');
      expect(text).toContain('529.982.247-25');
      expect(text).toContain('12.345.678-9');
    });

    it('formata telefone fixo e mantém CPF/telefone fora do padrão como digitados', () => {
      const base = data();
      base.adopter.phone = '4133334444';
      expect(flatText(buildContractDocDefinition({ data: base, clauses: clauses() }).content)).toContain('(41) 3333-4444');

      base.adopter.phone = '123';
      base.adopter.cpf = '123.456';
      const text = flatText(buildContractDocDefinition({ data: base, clauses: clauses() }).content);
      expect(text).toContain('TELEFONE: 123');
      expect(text).toContain('123.456');
    });

    it('marca espécie, sexo, sim/não e detalhes da medicação', () => {
      const text = flatText(buildContractDocDefinition({ data: fullData(), clauses: clauses() }).content);

      expect(text).toContain('FELINA');
      expect(text).toContain('FÊMEA');
      expect(text).toContain('CASTRADO?: ( ) SIM (X) NÃO');
      expect(text).toContain('VACINADO?: ( ) SIM ( ) NÃO');
      expect(text).toContain('(X) SIM ( ) NÃO — Antibiótico 2x ao dia');
    });

    it('sem medicação marcada não imprime os detalhes', () => {
      const base = fullData();
      base.animal.usesMedication = false;
      const text = flatText(buildContractDocDefinition({ data: base, clauses: clauses() }).content);

      expect(text).not.toContain('Antibiótico');
    });

    it('data de assinatura preenchida sai por extenso, sem a linha em branco', () => {
      const text = flatText(buildContractDocDefinition({ data: fullData(), clauses: clauses() }).content);

      expect(text).toContain('Londrina/PR, 02 de outubro de 2026.');
      expect(text).not.toContain('________ de');
    });

    it('assinatura com o nome do adotante e cidade padrão quando vazia', () => {
      const base = data();
      base.signature = { city: '  ', date: null };
      const text = flatText(buildContractDocDefinition({ data: base, clauses: clauses() }).content);

      expect(text).toContain('Curitiba/PR, ________ de');
      // A observação "(local e data da assinatura)" do modelo não vai para o PDF
      expect(text).not.toContain('local e data da assinatura');
      expect(text).toContain('ADOTANTE Maria da Silva');
    });
  });

  describe('cláusulas', () => {
    const custom = (content: string) =>
      numberClauses([{ key: 'custom', order: 1, content, originalContent: content, removed: false }]).clauses;
    // Conteúdo termina com a data e as assinaturas: os blocos da última cláusula vêm logo antes
    const contentOf = (list: ReturnType<typeof custom>) => buildContractDocDefinition({ data: data(), clauses: list }).content as any[];

    it('cláusula removida não sai no PDF e as demais são renumeradas', () => {
      const stored = CONTRACT_TEMPLATE.map((clause, index) => ({
        key: clause.key,
        order: index + 1,
        content: clause.content,
        originalContent: clause.content,
        removed: index === 2,
      }));
      const text = flatText(buildContractDocDefinition({ data: data(), clauses: numberClauses(stored).clauses }).content);

      expect(text).toContain('CLÁUSULA DÉCIMA TERCEIRA: ');
      expect(text).not.toContain('CLÁUSULA DÉCIMA QUARTA');
      expect(text).not.toContain(CONTRACT_TEMPLATE[2].content.split('\n')[0]);
    });

    it('título em negrito na mesma linha do primeiro parágrafo', () => {
      const [block] = contentOf(custom('Texto da cláusula.')).slice(-3, -2);
      const first = block.stack[0];

      expect(first.text[0]).toEqual({ text: 'CLÁUSULA PRIMEIRA: ', bold: true });
      expect(first.text[1]).toBe('Texto da cláusula.');
    });

    it('cláusula que começa com item "(a)" ganha o título em linha própria e itens recuados', () => {
      const [block] = contentOf(custom('(a) Primeiro item;\n(b) Segundo item.')).slice(-3, -2);

      expect(block.stack[0]).toEqual(expect.objectContaining({ text: 'CLÁUSULA PRIMEIRA:', bold: true }));
      expect(block.stack[1]).toEqual(expect.objectContaining({ text: '(a) Primeiro item;', margin: [18, 0, 0, 3] }));
      expect(block.stack[2]).toEqual(expect.objectContaining({ text: '(b) Segundo item.', margin: [18, 0, 0, 0] }));
    });

    it('"Parágrafo ..." tem o rótulo em negrito e blocos separados por linha em branco', () => {
      const content = contentOf(custom('Caput.\n\nParágrafo único: Texto do parágrafo.'));
      const [, paragraph] = content.slice(-4, -2);

      expect(paragraph.stack[0].text).toEqual([{ text: 'Parágrafo único:', bold: true }, ' Texto do parágrafo.']);
    });
  });

  it('metadados e rodapé com paginação', () => {
    const definition = buildContractDocDefinition({ data: data(), clauses: clauses() });

    expect(definition.info).toEqual(expect.objectContaining({ title: 'Termo de Adoção Responsável' }));
    expect((definition.footer as any)(2, 5)).toEqual(expect.objectContaining({ text: 'Página 2 de 5' }));
  });

  describe('loadImageAsDataUrl', () => {
    const originalFetch = global.fetch;
    afterEach(() => {
      global.fetch = originalFetch;
    });

    const mockFetch = (bytes: number[], ok = true) => {
      global.fetch = jest.fn(async () => ({ ok, arrayBuffer: async () => new Uint8Array(bytes).buffer })) as any;
    };

    it('aceita PNG e JPEG', async () => {
      mockFetch([0x89, 0x50, 0x4e, 0x47, 1]);
      expect(await loadImageAsDataUrl('https://x/a.png')).toMatch(/^data:image\/png;base64,/);

      mockFetch([0xff, 0xd8, 0xff, 1]);
      expect(await loadImageAsDataUrl('https://x/a.jpg')).toMatch(/^data:image\/jpeg;base64,/);
    });

    it('ignora WEBP, resposta com erro e falha de rede', async () => {
      mockFetch([0x52, 0x49, 0x46, 0x46]);
      expect(await loadImageAsDataUrl('https://x/a.webp')).toBeNull();

      mockFetch([0x89, 0x50, 0x4e, 0x47], false);
      expect(await loadImageAsDataUrl('https://x/a.png')).toBeNull();

      global.fetch = jest.fn(async () => {
        throw new Error('offline');
      }) as any;
      expect(await loadImageAsDataUrl('https://x/a.png')).toBeNull();
    });
  });
});
