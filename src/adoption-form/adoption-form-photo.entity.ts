import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { AdoptionForm } from './adoption-form.entity';

@Entity('adoption_form_photos')
export class AdoptionFormPhoto {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  url: string;

  @Column({ name: 'storage_path' })
  storagePath: string;

  @ManyToOne(() => AdoptionForm, (form) => form.fotos, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'adoption_form_id' })
  adoptionForm: AdoptionForm;

  @Column({ name: 'adoption_form_id' })
  adoptionFormId: string;

  @Column({ name: 'created_by', nullable: true })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
