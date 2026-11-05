import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, Index, Check } from 'typeorm';
import { Organization } from '../organization/organization.entity';
import { User } from '../user/user.entity';

/**
 * Notificação in-app (sino), genérica: qualquer módulo cria com NotificationService.notify.
 * `type` é texto livre do módulo de origem (ex.: MARKETING_MENTION). Só o dono lê e marca como lida.
 */
@Entity('notifications')
// Sino: não lidas primeiro/contagem e lista por data do próprio usuário
@Index('IDX_notifications_user_read_created', ['userId', 'readAt', 'createdAt'])
@Check('CHK_notifications_title_not_blank', `btrim("title") <> ''`)
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // CASCADE: notificação não sobrevive ao usuário apagado fisicamente
  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'FK_notifications_user' })
  user: User;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => Organization, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'organization_id', foreignKeyConstraintName: 'FK_notifications_organization' })
  organization: Organization;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ type: 'varchar', length: 50 })
  type: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text', nullable: true })
  body: string | null;

  /** Rota do front para abrir o assunto (ex.: /marketing?card=<id>) */
  @Column({ type: 'varchar', length: 500, nullable: true })
  link: string | null;

  /** Dados do gatilho (ids, nomes) para o front e para a deduplicação */
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
