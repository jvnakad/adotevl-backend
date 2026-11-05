import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { AdoptionContractService } from '../adoption-contract/adoption-contract.service';

export const AUTENTIQUE_HANDLED_EVENTS = ['signature.accepted', 'signature.rejected', 'document.finished'];

// Id do documento no payload: em eventos de assinatura vem em data.document; nos de documento, no próprio objeto
export const extractAutentiqueDocumentId = (body: any): string | null => {
  const data = body?.event?.data ?? {};
  const candidates = [data.document, data.document?.id, data.object?.document, data.object?.document?.id, data.object?.id, data.id];
  const id = candidates.find((value) => typeof value === 'string' && value);
  return id ?? null;
};

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(private readonly contractService: AdoptionContractService) {}

  async handleAutentique(rawBody: Buffer | undefined, signature: string | undefined, body: any) {
    this.assertAutentiqueSignature(rawBody, signature);

    const type = body?.event?.type;
    if (!AUTENTIQUE_HANDLED_EVENTS.includes(type)) return { received: true, ignored: true };

    const documentId = extractAutentiqueDocumentId(body);
    if (!documentId) {
      this.logger.warn(`Webhook ${type} do Autentique sem id do documento.`);
      return { received: true, ignored: true };
    }
    // Documento de outro sistema/conta: responde 200 para o Autentique não reenviar
    const handled = await this.contractService.syncSignatureByDocument(documentId);
    return { received: true, ignored: !handled };
  }

  // X-Autentique-Signature = HMAC-SHA256(secret, corpo original) em hex
  private assertAutentiqueSignature(rawBody: Buffer | undefined, signature: string | undefined) {
    const secret = process.env.AUTENTIQUE_WEBHOOK_SECRET;
    if (!secret) throw new UnauthorizedException('Webhook do Autentique não configurado.');
    if (!rawBody || !signature) throw new UnauthorizedException('Assinatura do webhook inválida.');

    const expected = Buffer.from(createHmac('sha256', secret).update(rawBody).digest('hex'));
    const received = Buffer.from(signature.trim().toLowerCase());
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      throw new UnauthorizedException('Assinatura do webhook inválida.');
    }
  }
}
