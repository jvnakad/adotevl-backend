import { extname } from 'path';

/** Tipo real do arquivo, pelo conteúdo (assinatura), e as extensões aceitas para ele. */
export interface DetectedFileType {
  kind: string;
  /** Extensões do nome do arquivo coerentes com o conteúdo (minúsculas, sem ponto) */
  extensions: string[];
  /** Extensão gravada no bucket quando o tipo tem uma só (a extensão vem do conteúdo, não do nome enviado) */
  canonicalExt?: string;
  mime: string;
}

const OOXML = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const OLE_MIMES: Record<string, string> = { doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint' };
const FTYP_IMAGE_BRANDS: Record<string, DetectedFileType> = {
  avif: { kind: 'avif', extensions: ['avif'], canonicalExt: 'avif', mime: 'image/avif' },
  avis: { kind: 'avif', extensions: ['avif'], canonicalExt: 'avif', mime: 'image/avif' },
  heic: { kind: 'heic', extensions: ['heic', 'heif'], canonicalExt: 'heic', mime: 'image/heic' },
  heix: { kind: 'heic', extensions: ['heic', 'heif'], canonicalExt: 'heic', mime: 'image/heic' },
  mif1: { kind: 'heic', extensions: ['heic', 'heif'], canonicalExt: 'heic', mime: 'image/heic' },
};

/** Extensões permitidas no nome do arquivo (imagem raster, vídeo, PDF, Office e zip). SVG, HTML e scripts nunca entram. */
export const ALLOWED_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'heic', 'heif',
  'mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip',
]);

const startsWith = (buffer: Buffer, bytes: number[], offset = 0) => buffer.length >= offset + bytes.length && bytes.every((byte, i) => buffer[offset + i] === byte);
const ascii = (buffer: Buffer, start: number, end: number) => buffer.subarray(start, end).toString('latin1');

/** Detecta o tipo pelos primeiros bytes. null = não é um dos tipos permitidos (inclui SVG, HTML, JS e texto). */
export function detectFileType(buffer: Buffer): DetectedFileType | null {
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: 'png', extensions: ['png'], canonicalExt: 'png', mime: 'image/png' };
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return { kind: 'jpeg', extensions: ['jpg', 'jpeg'], canonicalExt: 'jpg', mime: 'image/jpeg' };
  if (['GIF87a', 'GIF89a'].includes(ascii(buffer, 0, 6))) return { kind: 'gif', extensions: ['gif'], canonicalExt: 'gif', mime: 'image/gif' };
  if (ascii(buffer, 0, 4) === 'RIFF') {
    const form = ascii(buffer, 8, 12);
    if (form === 'WEBP') return { kind: 'webp', extensions: ['webp'], canonicalExt: 'webp', mime: 'image/webp' };
    if (form === 'AVI ') return { kind: 'avi', extensions: ['avi'], canonicalExt: 'avi', mime: 'video/x-msvideo' };
    return null;
  }
  if (ascii(buffer, 0, 5) === '%PDF-') return { kind: 'pdf', extensions: ['pdf'], canonicalExt: 'pdf', mime: 'application/pdf' };
  if (startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3])) return { kind: 'matroska', extensions: ['webm', 'mkv'], mime: 'video/webm' };
  if (startsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return { kind: 'ole', extensions: ['doc', 'xls', 'ppt'], mime: 'application/octet-stream' };
  if (ascii(buffer, 4, 8) === 'ftyp') {
    const brand = ascii(buffer, 8, 12);
    if (FTYP_IMAGE_BRANDS[brand]) return FTYP_IMAGE_BRANDS[brand];
    return { kind: 'isobmff', extensions: ['mp4', 'm4v', 'mov'], mime: brand === 'qt  ' ? 'video/quicktime' : 'video/mp4' };
  }
  if (startsWith(buffer, [0x50, 0x4b, 0x03, 0x04]) || startsWith(buffer, [0x50, 0x4b, 0x05, 0x06])) {
    // OOXML é um zip com word/, xl/ ou ppt/; zip comum não tem
    if (buffer.includes('word/')) return { kind: 'docx', extensions: ['docx'], canonicalExt: 'docx', mime: OOXML.docx };
    if (buffer.includes('xl/')) return { kind: 'xlsx', extensions: ['xlsx'], canonicalExt: 'xlsx', mime: OOXML.xlsx };
    if (buffer.includes('ppt/')) return { kind: 'pptx', extensions: ['pptx'], canonicalExt: 'pptx', mime: OOXML.pptx };
    return { kind: 'zip', extensions: ['zip'], canonicalExt: 'zip', mime: 'application/zip' };
  }
  return null;
}

export type AttachmentVerdict = { ok: true; ext: string; mime: string } | { ok: false; reason: string };

/**
 * Decide se o arquivo pode ser anexado: conteúdo reconhecido, extensão do nome na lista e coerente com o conteúdo.
 * Extensão e MIME gravados saem do conteúdo detectado (não do nome nem do Content-Type enviados pelo cliente).
 */
export function inspectAttachment(buffer: Buffer, fileName: string): AttachmentVerdict {
  const declared = extname(fileName).slice(1).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(declared)) return { ok: false, reason: 'extensão não permitida' };
  const detected = detectFileType(buffer);
  if (!detected) return { ok: false, reason: 'conteúdo não reconhecido' };
  if (!detected.extensions.includes(declared)) return { ok: false, reason: 'a extensão não combina com o conteúdo' };

  if (detected.kind === 'ole') return { ok: true, ext: declared, mime: OLE_MIMES[declared] };
  if (detected.kind === 'isobmff') return { ok: true, ext: declared === 'm4v' ? 'm4v' : declared === 'mov' ? 'mov' : 'mp4', mime: declared === 'mov' ? 'video/quicktime' : detected.mime };
  if (detected.kind === 'matroska') return { ok: true, ext: declared, mime: declared === 'mkv' ? 'video/x-matroska' : 'video/webm' };
  return { ok: true, ext: detected.canonicalExt, mime: detected.mime };
}
