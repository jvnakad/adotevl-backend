import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Organization } from '../organization/organization.entity';
import { AdoptionForm } from '../adoption-form/adoption-form.entity';
import { Pet } from '../pet/pet.entity';
import { StoredClause } from './contract-numbering';

export interface ContractAdopterData {
  name: string;
  age: string;
  birthDate: string;
  rg: string;
  cpf: string;
  email: string;
  phone: string;
  profession: string;
  address: string;
}

export interface ContractAnimalData {
  name: string;
  species: string;
  sex: string;
  breed: string;
  coat: string;
  distinctiveMarks: string;
  age: string;
  castrated: boolean | null;
  vaccinated: boolean | null;
  temperament: string;
  usesMedication: boolean | null;
  medicationDetails: string;
}

export interface ContractSignatureData {
  city: string;
  date: string | null;
}

export interface ContractData {
  adopter: ContractAdopterData;
  animal: ContractAnimalData;
  signature: ContractSignatureData;
}

// Contrato (termo de adoção) da ficha: rascunho editável + PDFs gerados (versões no bucket privado)
@Entity('adoption_contracts')
export class AdoptionContract {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => AdoptionForm, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'adoption_form_id' })
  adoptionForm: AdoptionForm;

  @Column({ name: 'adoption_form_id', unique: true })
  adoptionFormId: string;

  @ManyToOne(() => Pet, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'pet_id' })
  pet: Pet;

  @Column({ name: 'pet_id', nullable: true })
  petId: string;

  @Column({ type: 'jsonb' })
  data: ContractData;

  @Column({ type: 'jsonb' })
  clauses: StoredClause[];

  // 0 = nunca gerado; cada geração incrementa e grava contracts/<formId>/v<n>.pdf
  @Column({ type: 'int', default: 0 })
  version: number;

  @Column({ name: 'pdf_storage_path', nullable: true })
  pdfStoragePath: string;

  @Column({ name: 'generated_at', type: 'timestamptz', nullable: true })
  generatedAt: Date;

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
