import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Profile } from '../profile/profile.entity';
import { Organization } from '../organization/organization.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'full_name' })
  fullName: string;

  @Column()
  cpf: string;

  @Column({ unique: true })
  email: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ name: 'birth_date', type: 'date', nullable: true })
  birthDate: Date;

  @Column()
  password: string;

  @Column({ name: 'is_confirmed', default: false })
  isConfirmed: boolean;

  @Column({ name: 'is_approved', default: false })
  isApproved: boolean;

  @Column({ name: 'confirmation_code', nullable: true })
  confirmationCode: string;

  @ManyToOne(() => Profile, { nullable: false, eager: true })
  @JoinColumn({ name: 'profile_id' })
  profile: Profile;

  @Column({ name: 'profile_id' })
  profileId: string;

  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column({ default: true })
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
