import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Organization } from '../organization/organization.entity';

export enum PetStatus {
  DISPONIVEL = 'DISPONIVEL',
  EM_PROCESSO = 'EM_PROCESSO',
  ADOTADO = 'ADOTADO',
}

@Entity('pets')
export class Pet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column()
  species: string;

  @Column({ nullable: true })
  animal: string;

  @Column({ nullable: true })
  age: number;

  @Column()
  sex: string;

  @Column({ nullable: true })
  size: string;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  weight: number;

  @Column({ default: false })
  castration: boolean;

  @Column({ name: 'rescue_date', nullable: true })
  rescueDate: Date;

  @Column({ name: 'adoption_date', nullable: true })
  adoptionDate: Date;

  @Column({ nullable: true })
  about: string;

  @ManyToOne(() => Organization, { nullable: false })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column({ type: 'enum', enum: PetStatus, default: PetStatus.DISPONIVEL, nullable: true })
  status: PetStatus;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'created_by', nullable: true })
  createdBy: string;

  @Column({ name: 'updated_by', nullable: true })
  updatedBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
