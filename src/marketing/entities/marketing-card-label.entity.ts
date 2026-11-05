import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, Index } from 'typeorm';
import { MarketingCard } from './marketing-card.entity';
import { MarketingLabel } from './marketing-label.entity';

/** Etiqueta aplicada a um card. Vínculo: remover = DELETE (sem is_active). */
@Entity('marketing_card_labels')
@Index('UQ_marketing_card_labels_card_label', ['cardId', 'labelId'], { unique: true })
// "X cards usam esta etiqueta" e remoção dos vínculos ao excluir a etiqueta (C3); filtro por etiqueta (C13)
@Index('IDX_marketing_card_labels_label', ['labelId'])
export class MarketingCardLabel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => MarketingCard, (card) => card.cardLabels, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'card_id', foreignKeyConstraintName: 'FK_marketing_card_labels_card' })
  card: MarketingCard;

  @Column({ name: 'card_id', type: 'uuid' })
  cardId: string;

  // Etiqueta só tem soft delete; CASCADE cobre um eventual DELETE físico
  @ManyToOne(() => MarketingLabel, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'label_id', foreignKeyConstraintName: 'FK_marketing_card_labels_label' })
  label: MarketingLabel;

  @Column({ name: 'label_id', type: 'uuid' })
  labelId: string;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
