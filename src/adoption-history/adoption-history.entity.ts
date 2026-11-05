import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { Organization } from '../organization/organization.entity';
import { AdoptionForm, AdoptionFormStatus } from '../adoption-form/adoption-form.entity';

export enum AdoptionHistoryType {
  FICHA_CRIADA = 'FICHA_CRIADA',
  STATUS_ALTERADO = 'STATUS_ALTERADO',
  FICHA_EDITADA = 'FICHA_EDITADA',
  FOTO_ADICIONADA = 'FOTO_ADICIONADA',
  FOTO_REMOVIDA = 'FOTO_REMOVIDA',
  FICHA_REMOVIDA = 'FICHA_REMOVIDA',
  PET_VINCULADO = 'PET_VINCULADO',
  CONTRATO_DADOS_ALTERADOS = 'CONTRATO_DADOS_ALTERADOS',
  CLAUSULA_EDITADA = 'CLAUSULA_EDITADA',
  CLAUSULA_REMOVIDA = 'CLAUSULA_REMOVIDA',
  CLAUSULA_RESTAURADA = 'CLAUSULA_RESTAURADA',
  CONTRATO_GERADO = 'CONTRATO_GERADO',
  CONTRATO_ENVIADO_ASSINATURA = 'CONTRATO_ENVIADO_ASSINATURA',
  CONTRATO_ASSINADO = 'CONTRATO_ASSINADO',
  ASSINATURA_RECUSADA = 'ASSINATURA_RECUSADA',
  ASSINATURA_CANCELADA = 'ASSINATURA_CANCELADA',
  ADOCAO_CONCLUIDA = 'ADOCAO_CONCLUIDA',
}

// Log das movimentações da ficha (kanban, edições, contrato). Só recebe inserts.
@Entity('adoption_history_events')
@Index(['organizationId', 'createdAt'])
@Index(['adoptionFormId'])
export class AdoptionHistoryEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => AdoptionForm, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'adoption_form_id' })
  adoptionForm: AdoptionForm;

  @Column({ name: 'adoption_form_id' })
  adoptionFormId: string;

  // Snapshot do nome do adotante para a busca no histórico global sem join
  @Column({ name: 'adopter_name' })
  adopterName: string;

  @Column({ type: 'enum', enum: AdoptionHistoryType })
  type: AdoptionHistoryType;

  @Column({ name: 'from_status', type: 'enum', enum: AdoptionFormStatus, nullable: true })
  fromStatus: AdoptionFormStatus;

  @Column({ name: 'to_status', type: 'enum', enum: AdoptionFormStatus, nullable: true })
  toStatus: AdoptionFormStatus;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @Column({ name: 'user_id', nullable: true })
  userId: string;

  // Snapshot do nome: req.user não tem nome e o usuário pode ser renomeado/removido depois
  @Column({ name: 'user_name' })
  userName: string;

  @ManyToOne(() => Organization, { nullable: false })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'created_by', nullable: true })
  createdBy: string;

  @Column({ name: 'updated_by', nullable: true })
  updatedBy: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
