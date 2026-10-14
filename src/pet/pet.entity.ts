import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Organization } from '../organization/organization.entity';
import { PetPhoto } from './pet-photo.entity';

// Banco guarda o 1º dia do mês; a aplicação trabalha só com 'YYYY-MM'.
// O driver pg pode devolver `date` como Date à meia-noite local: lê ano/mês locais.
const birthMonthTransformer = {
  to: (value?: string | null) => (value ? `${value}-01` : value),
  from: (value: Date | string | null) => {
    if (!value) return null;
    if (!(value instanceof Date)) return String(value).slice(0, 7);
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`;
  },
};

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

  /** Mês/ano aproximado de nascimento ('YYYY-MM'). A idade é calculada na resposta (pet-age.ts). */
  @Column({ name: 'birth_date', type: 'date', nullable: true, transformer: birthMonthTransformer })
  birthDate: string | null;

  /** Legado: idade em anos. Só é lido na conversão para birthDate (PetService.onModuleInit). */
  @Column({ nullable: true, select: false })
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

  @OneToMany(() => PetPhoto, (photo) => photo.pet)
  fotos: PetPhoto[];

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
