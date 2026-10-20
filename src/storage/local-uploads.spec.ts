import { localSignatureQuery, localUploadsMiddleware, verifyLocalSignature } from './local-uploads';
import { StorageService } from './storage.service';

const makeRes = () => {
  const res: any = { headers: {}, statusCode: 200 };
  res.setHeader = (name: string, value: string) => (res.headers[name] = value);
  res.status = (code: number) => ((res.statusCode = code), res);
  res.json = (body: unknown) => ((res.body = body), res);
  res.end = () => res;
  return res;
};
const run = (path: string, query: Record<string, string> = {}) => {
  const res = makeRes();
  const next = jest.fn();
  localUploadsMiddleware({ path, query }, res, next);
  return { res, next };
};
const queryOf = (signature: string) => Object.fromEntries(new URLSearchParams(signature));

describe('link assinado do driver local', () => {
  it('assinatura válida confere; outro caminho, expirada ou adulterada não', () => {
    const query = queryOf(localSignatureQuery('marketing/o/c/a.png', 60));

    expect(verifyLocalSignature('marketing/o/c/a.png', query.exp, query.sig)).toBe(true);
    expect(verifyLocalSignature('marketing/o/c/b.png', query.exp, query.sig)).toBe(false);
    expect(verifyLocalSignature('marketing/o/c/a.png', query.exp, 'x'.repeat(64))).toBe(false);
    expect(verifyLocalSignature('marketing/o/c/a.png', query.exp, undefined)).toBe(false);
    expect(verifyLocalSignature('marketing/o/c/a.png', query.exp, query.sig, Date.now() + 61_000)).toBe(false);
    expect(verifyLocalSignature('marketing/o/c/a.png', String(Number(query.exp) + 1000), query.sig)).toBe(false);
  });
});

describe('localUploadsMiddleware', () => {
  it('anexo do Marketing sem link assinado é 403 e não segue para o arquivo', () => {
    const { res, next } = run('/marketing/o/c/a.png');

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('com link assinado segue; imagem raster e PDF abrem inline, o resto baixa como anexo', () => {
    for (const [file, disposition] of [['a.png', 'inline'], ['a.pdf', 'inline'], ['a.docx', 'attachment'], ['a.mp4', 'attachment'], ['a.zip', 'attachment']]) {
      const path = `marketing/o/c/${file}`;
      const { res, next } = run(`/${path}`, queryOf(localSignatureQuery(path, 60)));
      expect([file, next.mock.calls.length, res.headers['Content-Disposition']]).toEqual([file, 1, disposition]);
      expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
    }
  });

  it('assinatura de um arquivo não abre outro nem passa por ..', () => {
    const query = queryOf(localSignatureQuery('marketing/o/c/a.png', 60));

    expect(run('/marketing/o/c/b.png', query).res.statusCode).toBe(403);
    expect(run('/marketing/o/../../marketing/o/c/a.png', query).res.statusCode).toBe(403);
  });

  it('demais arquivos (fotos de pet) seguem sem assinatura, mas com nosniff', () => {
    const { res, next } = run('/pets/p1/a.png');

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
  });
});

describe('StorageService.getSignedUrls no driver local', () => {
  afterEach(() => delete process.env.STORAGE_DRIVER);

  it('anexo do Marketing recebe link com exp e sig que a verificação aceita; outros paths mantêm a URL simples', async () => {
    process.env.STORAGE_DRIVER = 'local';
    process.env.API_URL = 'http://api.local';

    const urls = await new StorageService().getSignedUrls(['marketing/o/c/a.png', 'adoption-forms/f1/a.png']);

    const url = new URL(urls['marketing/o/c/a.png']);
    expect(url.pathname).toBe('/uploads/marketing/o/c/a.png');
    expect(verifyLocalSignature('marketing/o/c/a.png', url.searchParams.get('exp'), url.searchParams.get('sig'))).toBe(true);
    expect(urls['adoption-forms/f1/a.png']).toBe('http://api.local/uploads/adoption-forms/f1/a.png');
  });
});
