import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { MARKETING_ATTACHMENT_MAX_BYTES, MarketingCardAttachment } from './entities/marketing-card-attachment.entity';
import { MarketingCard } from './entities/marketing-card.entity';
import { MarketingHistoryType } from './entities/marketing-history-event.entity';
import { MarketingHistoryService } from './marketing-history.service';
import { requireCard } from './marketing-card.helper';
import { toAttachmentResponse } from './marketing-presenter';
import { inspectAttachment } from './marketing-file-type';
import { StorageService } from '../storage/storage.service';

export { MARKETING_ATTACHMENT_MAX_BYTES };
export const MAX_FILES_PER_UPLOAD = 10;

const NOT_FOUND_MESSAGE = 'Anexo não encontrado.';
/** O Multer entrega o nome em latin1: reconverte para UTF-8, tira caminho e controles e limita a 255. */
export function cleanFileName(originalName: string) {
  const utf8 = Buffer.from(originalName ?? '', 'latin1').toString('utf8');
  const decoded = utf8.includes('�') ? originalName : utf8;
  const base = decoded.split(/[\\/]/).pop().replace(/[\p{Cc}\p{Cf}]/gu, '').trim();
  return (base || 'arquivo').slice(-255);
}

@Injectable()
export class MarketingAttachmentService {
  private readonly logger = new Logger(MarketingAttachmentService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly history: MarketingHistoryService,
    private readonly storage: StorageService,
  ) {}

  async findAll(cardId: string, organizationId: string) {
    const card = await requireCard(this.dataSource.manager, cardId, organizationId);
    const attachments = await this.dataSource.getRepository(MarketingCardAttachment).find({ where: { cardId, isActive: true }, order: { createdAt: 'ASC', id: 'ASC' } });
    const urls = await this.storage.getSignedUrls(attachments.map((attachment) => attachment.storagePath));
    return attachments.map((attachment) => toAttachmentResponse(attachment, urls, card.coverAttachmentId));
  }

  /** Sobe todos os arquivos ao bucket privado e grava anexos + eventos numa transação; falha remove o que já subiu. */
  async addFiles(cardId: string, files: Express.Multer.File[], userId: string, organizationId: string) {
    if (!files?.length) throw new BadRequestException('Envie ao menos um arquivo.');
    // O tipo vem do CONTEÚDO (assinatura), não do Content-Type nem do nome: SVG, HTML e scripts nunca passam.
    // O limite do Multer é MAX + 1 para que exatamente 30 MB passe; acima disso é 413 aqui.
    const inspected = files.map((file) => {
      const fileName = cleanFileName(file.originalname);
      if (file.size > MARKETING_ATTACHMENT_MAX_BYTES) throw new PayloadTooLargeException(`O arquivo ${fileName} passa de 30 MB.`);
      const verdict = inspectAttachment(file.buffer, fileName);
      if (verdict.ok === false) {
        throw new BadRequestException(`Tipo de arquivo não permitido (${fileName}): ${verdict.reason}. Envie imagem, vídeo, PDF, Office ou zip.`);
      }
      return { file, fileName, ext: verdict.ext, mime: verdict.mime };
    });
    await requireCard(this.dataSource.manager, cardId, organizationId, { mutation: true });

    const uploaded: string[] = [];
    try {
      const items = [];
      for (const { file, fileName, ext, mime } of inspected) {
        // Extensão e contentType saem do tipo detectado
        const storagePath = `marketing/${organizationId}/${cardId}/${randomUUID()}.${ext}`;
        await this.storage.uploadPrivate(storagePath, file.buffer, mime);
        uploaded.push(storagePath);
        items.push({ storagePath, fileName, mimeType: mime, sizeBytes: file.size });
      }

      const saved = await this.dataSource.transaction(async (manager) => {
        const card = await requireCard(manager, cardId, organizationId, { lock: true, mutation: true });
        const userName = await this.history.resolveUserName(manager, userId);
        const rows: MarketingCardAttachment[] = [];
        for (const item of items) {
          const attachment = await manager.save(manager.create(MarketingCardAttachment, { cardId, ...item, createdBy: userId, createdByName: userName, updatedBy: null }));
          rows.push(attachment);
          await this.history.record(manager, {
            organizationId,
            type: MarketingHistoryType.ANEXO_ADICIONADO,
            card,
            description: `Anexo ${attachment.fileName} adicionado.`,
            metadata: { attachmentId: attachment.id, fileName: attachment.fileName, mimeType: attachment.mimeType, sizeBytes: attachment.sizeBytes },
            userId,
            userName,
          });
        }
        return { rows, coverAttachmentId: card.coverAttachmentId };
      });
      const urls = await this.storage.getSignedUrls(saved.rows.map((attachment) => attachment.storagePath));
      return saved.rows.map((attachment) => toAttachmentResponse(attachment, urls, saved.coverAttachmentId));
    } catch (error) {
      await this.removeFiles(uploaded);
      throw error;
    }
  }

  /** Quem enviou ou Admin. Soft delete; se era a capa, a capa é limpa na mesma transação. O arquivo sai do bucket depois (best effort). */
  async remove(cardId: string, attachmentId: string, userId: string, organizationId: string, isAdmin: boolean) {
    const path = await this.dataSource.transaction(async (manager) => {
      const card = await requireCard(manager, cardId, organizationId, { lock: true, mutation: true });
      const attachment = await manager.findOne(MarketingCardAttachment, { where: { id: attachmentId, cardId, isActive: true } });
      if (!attachment) throw new NotFoundException(NOT_FOUND_MESSAGE);
      if (attachment.createdBy !== userId && !isAdmin) throw new ForbiddenException('Só quem enviou o anexo ou um administrador pode excluí-lo.');

      const userName = await this.history.resolveUserName(manager, userId);
      await manager.update(MarketingCardAttachment, { id: attachmentId }, { isActive: false, updatedBy: userId });
      if (card.coverAttachmentId === attachmentId) await manager.update(MarketingCard, { id: cardId }, { coverAttachmentId: null });
      await this.history.record(manager, {
        organizationId,
        type: MarketingHistoryType.ANEXO_REMOVIDO,
        card,
        description: `Anexo ${attachment.fileName} removido.`,
        metadata: { attachmentId, fileName: attachment.fileName, mimeType: attachment.mimeType, sizeBytes: attachment.sizeBytes },
        userId,
        userName,
      });
      return attachment.storagePath;
    });
    await this.removeFiles([path]);
    return { message: 'Anexo excluído com sucesso.' };
  }

  private async removeFiles(paths: string[]) {
    if (!paths.length) return;
    try {
      await this.storage.removePrivate(paths);
    } catch (error) {
      this.logger.warn(`Arquivo órfão no bucket (${paths.join(', ')}): ${(error as Error).message}`);
    }
  }
}
