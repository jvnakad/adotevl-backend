import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

export const AUTENTIQUE_API_URL = 'https://api.autentique.com.br/v2/graphql';
const REQUEST_TIMEOUT_MS = 30_000;

export interface AutentiqueSigner {
  name: string;
  email: string;
  // Onde carimbar a assinatura: página (1...) e x/y em % da página (canto superior esquerdo do carimbo)
  position?: { page: number; x: number; y: number } | null;
}

export interface CreateAutentiqueDocumentParams {
  name: string;
  pdf: Buffer;
  fileName: string;
  signers: AutentiqueSigner[];
}

// Conta dona do token (quem assina pela associação)
export interface AutentiqueAccount {
  name: string;
  email: string;
}

export interface AutentiqueSignature {
  publicId: string;
  name: string | null;
  email: string | null;
  link: string | null;
  viewedAt: string | null;
  signedAt: string | null;
  rejectedAt: string | null;
}

export interface AutentiqueDocument {
  id: string;
  name: string;
  signedFileUrl: string | null;
  signatures: AutentiqueSignature[];
}

const SIGNATURE_FIELDS = `
  public_id
  name
  email
  user { name email }
  link { short_link }
  viewed { created_at }
  signed { created_at }
  rejected { created_at }
`;

const CREATE_DOCUMENT = `
  mutation CreateDocument($document: DocumentInput!, $signers: [SignerInput!]!, $file: Upload!, $sandbox: Boolean, $folderId: UUID) {
    createDocument(sandbox: $sandbox, document: $document, signers: $signers, file: $file, folder_id: $folderId) {
      id
      name
      files { signed }
      signatures { ${SIGNATURE_FIELDS} }
    }
  }
`;

const GET_DOCUMENT = `
  query GetDocument($id: UUID!) {
    document(id: $id) {
      id
      name
      deleted_at
      files { signed }
      signatures { ${SIGNATURE_FIELDS} }
    }
  }
`;

const SIGN_DOCUMENT = `
  mutation SignDocument($id: UUID!) {
    signDocument(id: $id)
  }
`;

const ME = `
  query Me {
    me { name email }
  }
`;

const DELETE_DOCUMENT = `
  mutation DeleteDocument($id: UUID!) {
    deleteDocument(id: $id)
  }
`;

const toSignature = (raw: any): AutentiqueSignature => ({
  publicId: raw.public_id,
  name: raw.name ?? raw.user?.name ?? null,
  email: (raw.email ?? raw.user?.email ?? null)?.toLowerCase() ?? null,
  link: raw.link?.short_link ?? null,
  viewedAt: raw.viewed?.created_at ?? null,
  signedAt: raw.signed?.created_at ?? null,
  rejectedAt: raw.rejected?.created_at ?? null,
});

const toDocument = (raw: any): AutentiqueDocument => ({
  id: raw.id,
  name: raw.name,
  signedFileUrl: raw.files?.signed ?? null,
  signatures: (raw.signatures ?? []).map(toSignature),
});

// Cliente da API v2 do Autentique (GraphQL). Token lido sob demanda para o app subir sem a variável configurada.
@Injectable()
export class AutentiqueService {
  private readonly logger = new Logger(AutentiqueService.name);
  private account: AutentiqueAccount | null = null;

  private get token() {
    const token = process.env.AUTENTIQUE_TOKEN;
    if (!token) throw new ServiceUnavailableException('Integração com o Autentique não configurada.');
    return token;
  }

  // AUTENTIQUE_SANDBOX=true: documentos de teste, sem gastar créditos
  private get sandbox() {
    return process.env.AUTENTIQUE_SANDBOX === 'true';
  }

  // Pasta do painel onde os termos ficam salvos (ex.: "Termos de adoção"); vazio = raiz
  private get folderId() {
    return process.env.AUTENTIQUE_FOLDER_ID?.trim() || null;
  }

  async createDocument({ name, pdf, fileName, signers }: CreateAutentiqueDocumentParams): Promise<AutentiqueDocument> {
    // Upload no padrão GraphQL multipart request: operations + map + arquivo
    const body = new FormData();
    body.append(
      'operations',
      JSON.stringify({
        query: CREATE_DOCUMENT,
        variables: {
          document: { name },
          signers: signers.map((signer) => ({
            name: signer.name,
            email: signer.email,
            action: 'SIGN',
            ...(signer.position && {
              positions: [{ x: String(signer.position.x), y: String(signer.position.y), z: signer.position.page, element: 'SIGNATURE' }],
            }),
          })),
          file: null,
          sandbox: this.sandbox,
          folderId: this.folderId,
        },
      }),
    );
    body.append('map', JSON.stringify({ file: ['variables.file'] }));
    body.append('file', new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), fileName);

    const data = await this.request(body);
    return toDocument(data.createDocument);
  }

  // null quando o documento não existe mais no Autentique (excluído no painel/lixeira ou sandbox expirado)
  async getDocument(id: string): Promise<AutentiqueDocument | null> {
    const data = await this.request(JSON.stringify({ query: GET_DOCUMENT, variables: { id } }), ['document_not_found']);
    // A consulta por id ainda devolve documentos da lixeira
    return data.document && !data.document.deleted_at ? toDocument(data.document) : null;
  }

  // Conta dona do token; buscada uma vez (é a mesma enquanto o token não muda)
  async getAccount(): Promise<AutentiqueAccount> {
    if (!this.account) {
      const data = await this.request(JSON.stringify({ query: ME }));
      this.account = { name: data.me?.name, email: data.me?.email?.toLowerCase() };
    }
    return this.account;
  }

  // Assina o documento como a conta dona do token (precisa estar entre os signatários)
  async signDocument(id: string) {
    const data = await this.request(JSON.stringify({ query: SIGN_DOCUMENT, variables: { id } }));
    if (!data.signDocument) throw new BadGatewayException('Autentique: não foi possível assinar o documento pela associação.');
  }

  // Documento que já não existe (excluído no painel, sandbox expirado) conta como excluído
  async deleteDocument(id: string) {
    await this.request(JSON.stringify({ query: DELETE_DOCUMENT, variables: { id } }), ['document_not_found']);
  }

  // PDF assinado (com a folha de assinaturas) gerado pelo Autentique
  async downloadFile(url: string): Promise<Buffer> {
    const fetchFile = (headers: Record<string, string>) => fetch(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    try {
      let response = await fetchFile({ Authorization: `Bearer ${this.token}` });
      // Links pré-assinados recusam o header Authorization: tenta de novo sem ele
      if (!response.ok) response = await fetchFile({});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      this.logger.error(`Falha ao baixar arquivo do Autentique: ${error?.message}`);
      throw new BadGatewayException('Não foi possível baixar o termo de adoção assinado do Autentique.');
    }
  }

  // ignoredErrors: mensagens tratadas por quem chamou (ex.: document_not_found vira data null)
  private async request(body: string | FormData, ignoredErrors: string[] = []) {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}` };
    if (typeof body === 'string') headers['Content-Type'] = 'application/json';

    let payload: any;
    try {
      const response = await fetch(AUTENTIQUE_API_URL, { method: 'POST', headers, body, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      payload = await response.json().catch(() => null);
      if (!response.ok && !payload?.errors) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      this.logger.error(`Falha na comunicação com o Autentique: ${error?.message}`);
      throw new BadGatewayException('Não foi possível se comunicar com o Autentique. Tente novamente.');
    }

    const errors = (payload?.errors ?? []).filter((error: any) => !ignoredErrors.includes(error.message));
    if (errors.length) {
      const message = errors.map((error: any) => error.message).join('; ');
      this.logger.error(`Autentique respondeu com erro: ${message}`);
      throw new BadGatewayException(`Autentique: ${message}`);
    }
    return payload?.data ?? {};
  }
}
