import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common';
import { AUTENTIQUE_API_URL, AutentiqueService } from './autentique.service';

const jsonResponse = (body: any, status = 200) => ({ ok: status < 400, status, json: async () => body });

const rawDocument = {
  id: 'doc-1',
  name: 'Termo',
  files: { signed: 'https://api.autentique.com.br/documentos/doc-1/assinado.pdf' },
  signatures: [
    {
      public_id: 'sig-1',
      name: null,
      email: null,
      user: { name: 'Maria', email: 'Maria@Teste.com' },
      link: { short_link: 'https://assina.ae/x' },
      viewed: null,
      signed: { created_at: '2026-10-02 10:00:00' },
      rejected: null,
    },
  ],
};

const signer = { name: 'Maria', email: 'maria@teste.com' };

describe('AutentiqueService', () => {
  const env = { ...process.env };
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;
  let service: AutentiqueService;

  beforeEach(() => {
    process.env.AUTENTIQUE_TOKEN = 'token-teste';
    process.env.AUTENTIQUE_SANDBOX = 'true';
    delete process.env.AUTENTIQUE_FOLDER_ID;
    fetchMock = jest.fn();
    global.fetch = fetchMock as any;
    service = new AutentiqueService();
  });

  afterAll(() => {
    process.env = env;
    global.fetch = originalFetch;
  });

  it('sem token configurado responde 503', async () => {
    delete process.env.AUTENTIQUE_TOKEN;

    await expect(service.getDocument('doc-1')).rejects.toThrow(ServiceUnavailableException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cria o documento via GraphQL multipart com o adotante como signatário', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { createDocument: rawDocument } }));

    const document = await service.createDocument({ name: 'Termo', pdf: Buffer.from('%PDF'), fileName: 'termo.pdf', signer });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(AUTENTIQUE_API_URL);
    expect(init.headers).toEqual({ Authorization: 'Bearer token-teste' });
    const body = init.body as FormData;
    const operations = JSON.parse(body.get('operations') as string);
    expect(operations.variables).toEqual({
      document: { name: 'Termo' },
      signers: [{ name: 'Maria', email: 'maria@teste.com', action: 'SIGN' }],
      file: null,
      sandbox: true,
      folderId: null,
    });
    expect(JSON.parse(body.get('map') as string)).toEqual({ file: ['variables.file'] });
    expect((body.get('file') as File).name).toBe('termo.pdf');
    expect(document).toEqual({
      id: 'doc-1',
      name: 'Termo',
      signedFileUrl: 'https://api.autentique.com.br/documentos/doc-1/assinado.pdf',
      signatures: [
        { publicId: 'sig-1', name: 'Maria', email: 'maria@teste.com', link: 'https://assina.ae/x', viewedAt: null, signedAt: '2026-10-02 10:00:00', rejectedAt: null },
      ],
    });
  });

  it('AUTENTIQUE_SANDBOX diferente de true cria documento real', async () => {
    process.env.AUTENTIQUE_SANDBOX = 'false';
    fetchMock.mockResolvedValue(jsonResponse({ data: { createDocument: rawDocument } }));

    await service.createDocument({ name: 'Termo', pdf: Buffer.from('%PDF'), fileName: 'termo.pdf', signer });

    const operations = JSON.parse((fetchMock.mock.calls[0][1].body as FormData).get('operations') as string);
    expect(operations.variables.sandbox).toBe(false);
  });

  it('salva na pasta configurada em AUTENTIQUE_FOLDER_ID', async () => {
    process.env.AUTENTIQUE_FOLDER_ID = ' pasta-termos ';
    fetchMock.mockResolvedValue(jsonResponse({ data: { createDocument: rawDocument } }));

    await service.createDocument({ name: 'Termo', pdf: Buffer.from('%PDF'), fileName: 'termo.pdf', signer });

    const operations = JSON.parse((fetchMock.mock.calls[0][1].body as FormData).get('operations') as string);
    expect(operations.query).toContain('folder_id: $folderId');
    expect(operations.variables.folderId).toBe('pasta-termos');
  });

  it('documento inexistente devolve null', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ errors: [{ message: 'document_not_found' }], data: { document: null } }));

    await expect(service.getDocument('doc-x')).resolves.toBeNull();
  });

  it('excluir documento que já não existe não é erro', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ errors: [{ message: 'document_not_found' }], data: { deleteDocument: null } }));

    await expect(service.deleteDocument('doc-x')).resolves.toBeUndefined();
  });

  it('erro do GraphQL vira 502 com a mensagem do Autentique', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ errors: [{ message: 'unauthenticated' }] }, 401));

    await expect(service.deleteDocument('doc-1')).rejects.toThrow(new BadGatewayException('Autentique: unauthenticated'));
  });

  it('falha de rede vira 502', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));

    await expect(service.getDocument('doc-1')).rejects.toThrow('Não foi possível se comunicar com o Autentique');
  });

  it('baixa o PDF assinado e tenta sem Authorization se o link recusar', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 400 })
      .mockResolvedValueOnce({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('%PDF-ok').buffer });

    const pdf = await service.downloadFile('https://arquivo/assinado.pdf');

    expect(pdf.toString()).toBe('%PDF-ok');
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer token-teste' });
    expect(fetchMock.mock.calls[1][1].headers).toEqual({});
  });
});
