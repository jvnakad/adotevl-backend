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

@Entity('bank_accounts')
export class BankAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'bank_name' })
  bankName: string;

  @Column({ name: 'bank_code', nullable: true })
  bankCode: string;

  @Column({ nullable: true })
  agency: string;

  @Column({ name: 'agency_digit', nullable: true })
  agencyDigit: string;

  @Column({ name: 'account_number' })
  accountNumber: string;

  @Column({ name: 'account_digit', nullable: true })
  accountDigit: string;

  @Column({ name: 'account_type', nullable: true })
  accountType: string;

  @Column({ name: 'pix_key', nullable: true })
  pixKey: string;

  @Column({ name: 'pix_key_type', nullable: true })
  pixKeyType: string;

  @Column({ name: 'owner_name' })
  ownerName: string;

  @Column({ nullable: true })
  document: string;

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

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
