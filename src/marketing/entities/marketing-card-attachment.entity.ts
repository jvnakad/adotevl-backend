import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn, Index, Check } from 'typeorm';
import { MarketingCard } from './marketing-card.entity';

/** Limite por arquivo (D-08). Se mudar, troque também o nome do CHECK de tamanho (o sync compara checks pelo nome). */
export const MARKETING_ATTACHMENT_MAX_BYTES = 30 * 1024 * 1024;

/**
 * Anexo do card (C7). Arquivo no bucket privado do StorageService (uploadPrivate), sem URL gravada:
 * a URL é assinada a cada leitura (getSignedUrls). Path: marketing/<organizationId>/<cardId>/<uuid><ext>.
 */
@Entity('marketing_card_attachments')
@Index('IDX_marketing_card_attachments_card', ['cardId', 'isActive', 'createdAt'])
@Index('UQ_marketing_card_attachments_storage_path', ['storagePath'], { unique: true })
@Check('CHK_marketing_card_attachments_size_30mb', `"size_bytes" > 0 AND "size_bytes" <= 31457280`)
@Check('CHK_marketing_card_attachments_name_not_blank', `btrim("file_name") <> ''`)
export class MarketingCardAttachment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => MarketingCard, (card) => card.attachments, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'card_id', foreignKeyConstraintName: 'FK_marketing_card_attachments_card' })
  card: MarketingCard;

  @Column({ name: 'card_id', type: 'uuid' })
  cardId: string;

  /** Caminho no bucket privado */
  @Column({ name: 'storage_path', type: 'varchar', length: 500 })
  storagePath: string;

  /** Nome original do arquivo (exibição e download) */
  @Column({ name: 'file_name', type: 'varchar', length: 255 })
  fileName: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 150 })
  mimeType: string;

  @Column({ name: 'size_bytes', type: 'integer' })
  sizeBytes: number;

  /** Soft delete; o service remove o arquivo do bucket (best effort) e limpa a capa do card se for ela */
  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  /** Quem enviou: pode excluir o próprio anexo (Admin exclui qualquer um) */
  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @Column({ name: 'created_by_name', type: 'varchar' })
  createdByName: string;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
