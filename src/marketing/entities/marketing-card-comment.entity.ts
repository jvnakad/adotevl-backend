import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn, Index, Check } from 'typeorm';
import { MarketingCard } from './marketing-card.entity';

/** Usuário mencionado no comentário, com o nome do momento (o texto traz "@Nome"). */
export interface MarketingCommentMention {
  userId: string;
  name: string;
}

/** Comentário do card (C8). Mais recente primeiro. */
@Entity('marketing_card_comments')
@Index('IDX_marketing_card_comments_card_created_at', ['cardId', 'isActive', 'createdAt'])
@Check('CHK_marketing_card_comments_body_not_blank', `btrim("body") <> ''`)
@Check('CHK_marketing_card_comments_mentions_array', `jsonb_typeof("mentions") = 'array'`)
export class MarketingCardComment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => MarketingCard, (card) => card.comments, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'card_id', foreignKeyConstraintName: 'FK_marketing_card_comments_card' })
  card: MarketingCard;

  @Column({ name: 'card_id', type: 'uuid' })
  cardId: string;

  /** Texto puro com quebras de linha; menções escritas como "@Nome" */
  @Column({ type: 'text' })
  body: string;

  /** Menções válidas (usuários com Editar em MARKETING). Na edição, notificar só quem entrou na lista */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  mentions: MarketingCommentMention[];

  /** Autor (sem FK para users, padrão do projeto): só ele edita; ele ou Admin excluem */
  @Column({ name: 'author_id', type: 'uuid' })
  authorId: string;

  // Snapshot: o nome continua aparecendo se o usuário for renomeado/removido
  @Column({ name: 'author_name', type: 'varchar' })
  authorName: string;

  /** Marca "editado": só muda quando o texto muda (updated_at também muda no soft delete) */
  @Column({ name: 'edited_at', type: 'timestamptz', nullable: true })
  editedAt: Date | null;

  /** Soft delete (autor ou Admin) */
  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
