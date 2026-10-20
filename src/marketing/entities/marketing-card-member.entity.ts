import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, Index } from 'typeorm';
import { User } from '../../user/user.entity';
import { MarketingCard } from './marketing-card.entity';

/**
 * Membro do card. Vínculo: remover = DELETE (sem is_active); o histórico guarda MEMBRO_ADICIONADO/REMOVIDO.
 * Só usuário com Editar em MARKETING pode ser membro (D-09): regra da aplicação, o banco não conhece permissões.
 */
@Entity('marketing_card_members')
@Index('UQ_marketing_card_members_card_user', ['cardId', 'userId'], { unique: true })
// Filtro "meus cards" / por membro (C13) e notificações (C12)
@Index('IDX_marketing_card_members_user', ['userId'])
export class MarketingCardMember {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => MarketingCard, (card) => card.members, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'card_id', foreignKeyConstraintName: 'FK_marketing_card_members_card' })
  card: MarketingCard;

  @Column({ name: 'card_id', type: 'uuid' })
  cardId: string;

  // CASCADE: se o usuário for apagado fisicamente (LGPD, teardown do e2e), o vínculo vai junto
  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'FK_marketing_card_members_user' })
  user: User;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
