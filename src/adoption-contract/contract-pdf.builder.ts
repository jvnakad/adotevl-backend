import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import { ContractData } from './adoption-contract.entity';
import { NumberedClause } from './contract-numbering';
import {
  CONTRACT_INTRO,
  CONTRACT_ORGANIZATION,
  CONTRACT_SUBTITLE,
  CONTRACT_TITLE,
  DEFAULT_SIGNATURE_CITY,
} from './contract-template';
import { CONTRACT_LOGO_DATA_URL } from './assets/logo.base64';

// pdfmake 0.3 no servidor: o módulo exporta uma instância única (createPdf().getBuffer())
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfmake = require('pdfmake');

// Fontes padrão do PDF (Helvetica), sem arquivo de fonte no projeto
const STANDARD_FONTS = ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique'];
pdfmake.setFonts({
  Helvetica: { normal: 'Helvetica', bold: 'Helvetica-Bold', italics: 'Helvetica-Oblique', bolditalics: 'Helvetica-BoldOblique' },
});
// Nada de acesso a disco/URL durante a montagem: imagens entram como data URL
pdfmake.setLocalAccessPolicy((path: string) => STANDARD_FONTS.includes(path));
pdfmake.setUrlAccessPolicy(() => false);

// Página A4 e margens do termo (também usadas para posicionar a assinatura do Autentique)
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const PAGE_MARGINS: [number, number, number, number] = [60, 90, 60, 60];
const SIGNATURE_COLUMN_GAP = 30;
const ADOPTER_SIGNATURE_LINE_ID = 'adopter-signature-line';
// Carimbo de assinatura do Autentique em escala 1 (medido): ponto (x, y) = canto superior esquerdo,
// rubrica em cima e "Assinado eletronicamente" embaixo, ~98 x 28 pt
const AUTENTIQUE_STAMP_WIDTH = 98;
const AUTENTIQUE_STAMP_HEIGHT = 28;

// Onde o Autentique deve carimbar a assinatura do adotante: página (1...) e x/y em % da página
export interface SignaturePosition {
  page: number;
  x: number;
  y: number;
}

export interface ContractPdfResult {
  buffer: Buffer;
  adopterSignature: SignaturePosition | null;
}

export interface ContractPdfInput {
  data: ContractData;
  clauses: NumberedClause[];
  // Primeira foto do pet como data URL (PNG/JPEG); sem foto o bloco é omitido
  petPhoto?: string | null;
}

const BLANK = '______________________________________';
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const LIST_ITEM = /^\([a-z]\)\s/;
const PHOTO_FETCH_TIMEOUT_MS = 8000;

const valueOrBlank = (value?: string | null) => (value && String(value).trim() ? String(value).trim() : BLANK);

const formatCpf = (cpf: string) => {
  const digits = (cpf ?? '').replace(/\D/g, '');
  return digits.length === 11 ? digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : cpf;
};

const formatPhone = (phone: string) => {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length === 11) return digits.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  if (digits.length === 10) return digits.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  return phone;
};

// "1990-05-10" -> "10/05/1990"
const formatDateBr = (date: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '');
  return match ? `${match[3]}/${match[2]}/${match[1]}` : date;
};

// "2026-10-02" -> "02 de outubro de 2026"
export const formatLongDatePt = (date: string | null) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '');
  if (!match) return null;
  return `${match[3]} de ${MONTHS[Number(match[2]) - 1]} de ${match[1]}`;
};

const mark = (value: boolean | null) => `(${value === true ? 'X' : ' '}) SIM  (${value === false ? 'X' : ' '}) NÃO`;

const labeled = (label: string, value: string): Content => ({ text: [{ text: `${label}: `, bold: true }, value], margin: [0, 0, 0, 2] });

// Primeira foto do pet para a Cláusula 1; qualquer falha (rede, formato) só omite a foto
export async function loadImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(PHOTO_FETCH_TIMEOUT_MS) });
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    // pdfkit só aceita PNG e JPEG (WEBP fica de fora)
    if (buffer.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return `data:image/png;base64,${buffer.toString('base64')}`;
    if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return `data:image/jpeg;base64,${buffer.toString('base64')}`;
    return null;
  } catch {
    return null;
  }
}

// Linha da cláusula: item "(a)" recuado, "Parágrafo ..." com rótulo em negrito, o resto como parágrafo
function clauseLine(line: string, last: boolean): Content {
  const margin: [number, number, number, number] = [0, 0, 0, last ? 0 : 3];
  if (LIST_ITEM.test(line)) return { text: line, margin: [18, 0, 0, last ? 0 : 3] };
  if (/^Parágrafo/i.test(line)) {
    const cut = line.search(/[.:]/);
    if (cut > 0) return { text: [{ text: line.slice(0, cut + 1), bold: true }, line.slice(cut + 1)], margin };
  }
  return { text: line, margin };
}

function clauseContent(clause: NumberedClause): Content[] {
  const blocks = clause.content
    .split(/\n{2,}/)
    .map((block) => block.split('\n').map((line) => line.trim()).filter(Boolean))
    .filter((lines) => lines.length);

  return blocks.map((lines, blockIndex) => {
    const stack: Content[] = lines.map((line, index) => {
      const last = index === lines.length - 1;
      // Título em negrito na mesma linha do primeiro parágrafo, como no modelo
      if (blockIndex === 0 && index === 0 && !LIST_ITEM.test(line)) {
        return { text: [{ text: `${clause.heading}: `, bold: true }, line], margin: [0, 0, 0, last ? 0 : 3] };
      }
      return clauseLine(line, last);
    });
    if (blockIndex === 0 && LIST_ITEM.test(lines[0])) stack.unshift({ text: `${clause.heading}:`, bold: true, margin: [0, 0, 0, 3] });
    return { stack, margin: [0, 0, 0, 8] };
  });
}

function animalBlock(data: ContractData, petPhoto?: string | null): Content[] {
  const animal = data.animal;
  const species = animal.species === 'CANINA' ? 'CANINA' : animal.species === 'FELINA' ? 'FELINA' : '';
  const sex = animal.sex === 'MACHO' ? 'MACHO' : animal.sex === 'FEMEA' ? 'FÊMEA' : '';
  const medication = animal.usesMedication && animal.medicationDetails?.trim() ? ` — ${animal.medicationDetails.trim()}` : '';

  const content: Content[] = [];
  if (petPhoto) content.push({ image: petPhoto, fit: [220, 200], alignment: 'center', margin: [0, 2, 0, 10] });
  content.push({
    stack: [
      labeled('NOME', valueOrBlank(animal.name)),
      labeled('ESPÉCIE (CANINA/FELINA)', valueOrBlank(species)),
      labeled('SEXO (MACHO/FÊMEA)', valueOrBlank(sex)),
      labeled('RAÇA', valueOrBlank(animal.breed)),
      labeled('PELAGEM', valueOrBlank(animal.coat)),
      labeled('SINAIS CARACTERÍSTICOS', valueOrBlank(animal.distinctiveMarks)),
      labeled('IDADE', valueOrBlank(animal.age)),
      labeled('CASTRADO?', mark(animal.castrated)),
      labeled('VACINADO?', mark(animal.vaccinated)),
      labeled('TEMPERAMENTO', valueOrBlank(animal.temperament)),
      labeled('UTILIZA MEDICAÇÃO', `${mark(animal.usesMedication)}${medication}`),
    ],
    alignment: 'left',
    margin: [0, 0, 0, 10],
  });
  return content;
}

export function buildContractDocDefinition({ data, clauses, petPhoto }: ContractPdfInput): TDocumentDefinitions {
  const adopter = data.adopter;
  const org = CONTRACT_ORGANIZATION;
  const city = data.signature?.city?.trim() || DEFAULT_SIGNATURE_CITY;
  const longDate = formatLongDatePt(data.signature?.date);
  const adopterName = adopter.name?.trim();

  const clausesContent: Content[] = clauses.flatMap((clause) => {
    const parts = clauseContent(clause);
    return clause.key === 'animal' ? [...parts, ...animalBlock(data, petPhoto)] : parts;
  });

  const signature = (title: string, subtitle: string, lineId?: string): Content => ({
    stack: [
      { text: '____________________________________', margin: [0, 0, 0, 4], ...(lineId && { id: lineId }) },
      { text: title, bold: true },
      { text: subtitle },
    ],
    alignment: 'center',
  });

  return {
    pageSize: 'A4',
    pageMargins: PAGE_MARGINS,
    info: { title: 'Termo de Adoção Responsável', author: org.name },
    defaultStyle: { font: 'Helvetica', fontSize: 11, alignment: 'justify', lineHeight: 1.15 },
    header: { image: CONTRACT_LOGO_DATA_URL, width: 88, alignment: 'center', margin: [0, 24, 0, 0] },
    footer: (currentPage: number, pageCount: number) => ({
      text: `Página ${currentPage} de ${pageCount}`,
      alignment: 'center',
      fontSize: 9,
      margin: [0, 20, 0, 0],
    }),
    content: [
      { text: CONTRACT_TITLE, bold: true, fontSize: 12, alignment: 'center', margin: [0, 0, 0, 4] },
      { text: CONTRACT_SUBTITLE, bold: true, fontSize: 12, alignment: 'center', margin: [0, 0, 0, 16] },

      { text: 'DADOS DA ENTIDADE', bold: true, margin: [0, 0, 0, 4] },
      {
        stack: [
          labeled('NOME', org.name),
          labeled('CNPJ', org.cnpj),
          labeled('E-MAIL', org.email),
          labeled('ENDEREÇO', org.address),
          labeled('CIDADE/ESTADO', org.cityState),
          labeled('TELEFONE', org.phone),
          labeled('REPRESENTANTE LEGAL', org.legalRepresentative),
        ],
        alignment: 'left',
      },
      { text: [{ text: 'doravante denominada ' }, { text: 'DOADORA', bold: true }, ';'], margin: [0, 4, 0, 14] },

      { text: 'DADOS DO(A) DONATÁRIO(A)', bold: true, margin: [0, 0, 0, 4] },
      {
        stack: [
          labeled('NOME', valueOrBlank(adopter.name)),
          labeled('IDADE', valueOrBlank(adopter.age)),
          labeled('DATA DE NASCIMENTO', valueOrBlank(formatDateBr(adopter.birthDate))),
          labeled('Nº DO RG', valueOrBlank(adopter.rg)),
          labeled('Nº DO CPF', valueOrBlank(formatCpf(adopter.cpf))),
          labeled('E-MAIL', valueOrBlank(adopter.email)),
          labeled('TELEFONE', valueOrBlank(formatPhone(adopter.phone))),
          labeled('PROFISSÃO', valueOrBlank(adopter.profession)),
          labeled('ENDEREÇO (com CEP e complemento)', valueOrBlank(adopter.address)),
        ],
        alignment: 'left',
      },
      { text: [{ text: 'doravante denominada parte ' }, { text: 'ADOTANTE', bold: true }, ';'], margin: [0, 4, 0, 14] },

      { text: CONTRACT_INTRO, margin: [0, 0, 0, 12] },

      ...clausesContent,

      {
        stack: [
          { text: longDate ? `${city}, ${longDate}.` : `${city}, ________ de _________________ de ____________` },
        ],
        alignment: 'left',
        margin: [0, 18, 0, 50],
        unbreakable: true,
      },
      {
        columns: [
          signature(org.signatureName, 'Representante legal'),
          signature('ADOTANTE', adopterName || ' ', ADOPTER_SIGNATURE_LINE_ID),
        ],
        columnGap: SIGNATURE_COLUMN_GAP,
        unbreakable: true,
      },
    ],
  };
}

// Converte a posição da linha "ADOTANTE" (pt) no ponto do carimbo do Autentique: centralizado na coluna, logo acima da linha
export function toAutentiquePosition(page: number, lineTop: number): SignaturePosition {
  const contentWidth = PAGE_WIDTH - PAGE_MARGINS[0] - PAGE_MARGINS[2];
  const columnWidth = (contentWidth - SIGNATURE_COLUMN_GAP) / 2;
  const columnCenter = PAGE_MARGINS[0] + columnWidth + SIGNATURE_COLUMN_GAP + columnWidth / 2;
  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    page,
    x: round(((columnCenter - AUTENTIQUE_STAMP_WIDTH / 2) / PAGE_WIDTH) * 100),
    y: round((Math.max(lineTop - AUTENTIQUE_STAMP_HEIGHT, 0) / PAGE_HEIGHT) * 100),
  };
}

export async function buildContractPdf(input: ContractPdfInput): Promise<ContractPdfResult> {
  let adopterSignature: SignaturePosition | null = null;
  const definition: TDocumentDefinitions = {
    ...buildContractDocDefinition(input),
    // Só para ler onde a linha do adotante caiu (página e altura); nunca força quebra
    pageBreakBefore: (node: any) => {
      if (node.id === ADOPTER_SIGNATURE_LINE_ID && node.startPosition) {
        adopterSignature = toAutentiquePosition(node.startPosition.pageNumber, node.startPosition.top);
      }
      return false;
    },
  };
  const buffer: Buffer = await pdfmake.createPdf(definition).getBuffer();
  return { buffer, adopterSignature };
}
