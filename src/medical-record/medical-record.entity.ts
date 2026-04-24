import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Pet } from '../pet/pet.entity';

export enum MedicalRecordType {
  CONSULTA = 'CONSULTA',
  VACINA = 'VACINA',
  MEDICACAO = 'MEDICACAO',
  EXAME = 'EXAME',
  PROCEDIMENTO = 'PROCEDIMENTO',
}

@Entity('medical_records')
export class MedicalRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Pet, { nullable: false })
  @JoinColumn({ name: 'pet_id' })
  pet: Pet;

  @Column({ name: 'pet_id' })
  petId: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'enum', enum: MedicalRecordType })
  type: MedicalRecordType;

  @Column()
  description: string;

  @Column({ name: 'veterinarian_name', nullable: true })
  veterinarianName: string;

  @Column({ name: 'next_date', type: 'date', nullable: true })
  nextDate: string;

  @Column({ name: 'attachment_url', nullable: true })
  attachmentUrl: string;

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
