import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, Index, Check } from 'typeorm';
import { User } from './user.entity';

export type EmailChangeEventKind = 'PASSWORD_FAILED' | 'PASSWORD_LOCK' | 'CODE_LOCK' | 'EMAIL_IN_USE';

/**
 * Eventos da troca de e-mail que não geram pedido: senha errada, bloqueios e respostas "e-mail em uso"
 * (estas contam nos limites por hora e por dia). Sem e-mail, senha nem código. Ver docs/db/troca-email.md.
 */
@Entity('email_change_events')
@Index('IDX_email_change_events_user_kind_created', ['userId', 'kind', 'createdAt'])
@Check('CHK_email_change_events_kind', `"kind" IN ('PASSWORD_FAILED', 'PASSWORD_LOCK', 'CODE_LOCK', 'EMAIL_IN_USE')`)
export class EmailChangeEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'FK_email_change_events_user' })
  user: User;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 20 })
  kind: EmailChangeEventKind;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
