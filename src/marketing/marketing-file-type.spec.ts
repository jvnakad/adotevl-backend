import { detectFileType, inspectAttachment } from './marketing-file-type';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('resto')]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('resto')]);
const PDF = Buffer.from('%PDF-1.7\n...');
const zip = (entry: string) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(`....${entry}....`)]);
const ftyp = (brand: string) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftyp'), Buffer.from(brand), Buffer.alloc(8)]);
const riff = (form: string) => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from(form)]);
const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);

describe('detectFileType', () => {
  it('reconhece os tipos permitidos pelo conteúdo', () => {
    expect(detectFileType(PNG)?.kind).toBe('png');
    expect(detectFileType(JPEG)?.kind).toBe('jpeg');
    expect(detectFileType(Buffer.from('GIF89a....'))?.kind).toBe('gif');
    expect(detectFileType(riff('WEBP'))?.kind).toBe('webp');
    expect(detectFileType(riff('AVI '))?.kind).toBe('avi');
    expect(detectFileType(PDF)?.kind).toBe('pdf');
    expect(detectFileType(ftyp('isom'))?.kind).toBe('isobmff');
    expect(detectFileType(ftyp('avif'))?.kind).toBe('avif');
    expect(detectFileType(ftyp('heic'))?.kind).toBe('heic');
    expect(detectFileType(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0]))?.kind).toBe('matroska');
    expect(detectFileType(OLE)?.kind).toBe('ole');
    expect(detectFileType(zip('word/document.xml'))?.kind).toBe('docx');
    expect(detectFileType(zip('xl/workbook.xml'))?.kind).toBe('xlsx');
    expect(detectFileType(zip('ppt/slides/slide1.xml'))?.kind).toBe('pptx');
    expect(detectFileType(zip('foto.jpg'))?.kind).toBe('zip');
  });

  it('SVG, HTML, JS, texto e arquivo vazio não são reconhecidos', () => {
    for (const text of ['<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script/></svg>', '<!DOCTYPE html><script>alert(1)</script>', 'alert(1)', '<?xml version="1.0"?><svg/>', '']) {
      expect(detectFileType(Buffer.from(text))).toBeNull();
    }
  });
});

describe('inspectAttachment (BUG-02)', () => {
  it('aceita quando extensão e conteúdo combinam; extensão e mime saem do conteúdo', () => {
    expect(inspectAttachment(PNG, 'arte.PNG')).toEqual({ ok: true, ext: 'png', mime: 'image/png' });
    expect(inspectAttachment(JPEG, 'foto.jpeg')).toEqual({ ok: true, ext: 'jpg', mime: 'image/jpeg' });
    expect(inspectAttachment(PDF, 'roteiro.pdf')).toEqual({ ok: true, ext: 'pdf', mime: 'application/pdf' });
    expect(inspectAttachment(ftyp('isom'), 'video.mp4')).toEqual({ ok: true, ext: 'mp4', mime: 'video/mp4' });
    expect(inspectAttachment(ftyp('qt  '), 'video.mov')).toEqual({ ok: true, ext: 'mov', mime: 'video/quicktime' });
    expect(inspectAttachment(zip('word/document.xml'), 'texto.docx').ok).toBe(true);
    expect(inspectAttachment(OLE, 'planilha.xls')).toEqual({ ok: true, ext: 'xls', mime: 'application/vnd.ms-excel' });
    expect(inspectAttachment(zip('a.txt'), 'pacote.zip')).toEqual({ ok: true, ext: 'zip', mime: 'application/zip' });
  });

  it('recusa SVG e HTML mesmo com extensão de imagem ou PDF', () => {
    const svg = Buffer.from('<svg onload="alert(1)"><script>alert(1)</script></svg>');
    const html = Buffer.from('<html><script>alert(1)</script></html>');

    expect(inspectAttachment(svg, 'evil.png')).toMatchObject({ ok: false, reason: 'conteúdo não reconhecido' });
    expect(inspectAttachment(html, 'evil.pdf')).toMatchObject({ ok: false });
    expect(inspectAttachment(svg, 'evil.svg')).toMatchObject({ ok: false, reason: 'extensão não permitida' });
    expect(inspectAttachment(html, 'evil.html')).toMatchObject({ ok: false, reason: 'extensão não permitida' });
  });

  it('recusa extensão fora da lista, mesmo com conteúdo válido', () => {
    expect(inspectAttachment(PNG, 'arte.svg')).toMatchObject({ ok: false, reason: 'extensão não permitida' });
    expect(inspectAttachment(PDF, 'arte.exe')).toMatchObject({ ok: false });
    expect(inspectAttachment(PNG, 'semextensao')).toMatchObject({ ok: false });
    expect(inspectAttachment(PNG, 'arte.png.js')).toMatchObject({ ok: false });
  });

  it('recusa extensão que não combina com o conteúdo', () => {
    expect(inspectAttachment(PNG, 'foto.jpg')).toMatchObject({ ok: false, reason: 'a extensão não combina com o conteúdo' });
    expect(inspectAttachment(PDF, 'arte.png')).toMatchObject({ ok: false });
    expect(inspectAttachment(zip('a.txt'), 'texto.docx')).toMatchObject({ ok: false });
    expect(inspectAttachment(OLE, 'x.docx')).toMatchObject({ ok: false });
  });

  it('a extensão gravada vem do conteúdo, não do nome: jpeg chamado .jpeg vira .jpg', () => {
    expect((inspectAttachment(JPEG, 'a.jpeg') as any).ext).toBe('jpg');
  });
});
