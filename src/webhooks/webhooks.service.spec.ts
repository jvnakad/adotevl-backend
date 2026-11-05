import { UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { extractAutentiqueDocumentId, WebhooksService } from './webhooks.service';

const sign = (raw: Buffer, secret = 'segredo') => createHmac('sha256', secret).update(raw).digest('hex');
const payload = (type: string, data: Record<string, any>) => ({ id: 'wh-1', object: 'webhook', event: { id: 'ev-1', type, data } });

describe('WebhooksService', () => {
  const env = { ...process.env };
  let contracts: { syncSignatureByDocument: jest.Mock };
  let service: WebhooksService;

  beforeEach(() => {
    process.env.AUTENTIQUE_WEBHOOK_SECRET = 'segredo';
    contracts = { syncSignatureByDocument: jest.fn(async () => true) };
    service = new WebhooksService(contracts as any);
  });

  afterAll(() => {
    process.env = env;
  });

  const call = (body: any, signature?: string) => {
    const raw = Buffer.from(JSON.stringify(body));
    return service.handleAutentique(raw, signature ?? sign(raw), body);
  };

  it('assinatura válida sincroniza o contrato do documento', async () => {
    await expect(call(payload('signature.accepted', { document: 'doc-1', public_id: 'sig-1' }))).resolves.toEqual({ received: true, ignored: false });
    expect(contracts.syncSignatureByDocument).toHaveBeenCalledWith('doc-1');
  });

  it('assinatura HMAC inválida responde 401', async () => {
    await expect(call(payload('signature.accepted', { document: 'doc-1' }), sign(Buffer.from('outro')))).rejects.toThrow(UnauthorizedException);
    expect(contracts.syncSignatureByDocument).not.toHaveBeenCalled();
  });

  it('sem header de assinatura responde 401', async () => {
    const body = payload('signature.accepted', { document: 'doc-1' });

    await expect(service.handleAutentique(Buffer.from(JSON.stringify(body)), undefined, body)).rejects.toThrow(UnauthorizedException);
  });

  it('sem secret configurado recusa o webhook', async () => {
    delete process.env.AUTENTIQUE_WEBHOOK_SECRET;

    await expect(call(payload('signature.accepted', { document: 'doc-1' }))).rejects.toThrow('Webhook do Autentique não configurado.');
  });

  it('eventos não tratados são ignorados', async () => {
    await expect(call(payload('signature.viewed', { document: 'doc-1' }))).resolves.toEqual({ received: true, ignored: true });
    expect(contracts.syncSignatureByDocument).not.toHaveBeenCalled();
  });

  it('documento de fora do sistema responde 200 ignorado', async () => {
    contracts.syncSignatureByDocument.mockResolvedValue(false);

    await expect(call(payload('document.finished', { object: { id: 'doc-x' } }))).resolves.toEqual({ received: true, ignored: true });
  });

  it.each([
    [{ document: 'doc-1' }, 'doc-1'],
    [{ document: { id: 'doc-2' } }, 'doc-2'],
    [{ object: { id: 'doc-3' } }, 'doc-3'],
    [{ id: 'doc-4' }, 'doc-4'],
    [{}, null],
  ])('extrai o id do documento de %j', (data, expected) => {
    expect(extractAutentiqueDocumentId(payload('document.finished', data))).toBe(expected);
  });
});
