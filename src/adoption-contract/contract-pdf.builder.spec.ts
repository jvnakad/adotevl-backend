import { buildContractDocDefinition, buildContractPdf, formatLongDatePt, loadImageAsDataUrl } from './contract-pdf.builder';
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

describe('contract-pdf.builder', () => {
  it('gera um Buffer de PDF', async () => {
    const buffer = await buildContractPdf({ data: data(), clauses: clauses() });

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  }, 30000);

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
