import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Campaign } from '../campaign/campaign.entity';
import { BankAccount } from '../bank-account/bank-account.entity';

export enum PaymentMethod {
  DEBITO = 'DEBITO',
  CREDITO = 'CREDITO',
  PIX = 'PIX',
  OUTROS = 'OUTROS',
}

@Entity('financial_entries')
export class FinancialEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  sender: string;

  @ManyToOne(() => Campaign, { nullable: true })
  @JoinColumn({ name: 'campaign_id' })
  campaign: Campaign;

  @Column({ name: 'campaign_id', nullable: true })
  campaignId: string;

  @ManyToOne(() => BankAccount, { nullable: false })
  @JoinColumn({ name: 'bank_account_id' })
  bankAccount: BankAccount;

  @Column({ name: 'bank_account_id' })
  bankAccountId: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column({ name: 'payment_method', type: 'enum', enum: PaymentMethod })
  paymentMethod: PaymentMethod;

  @Column({ name: 'transaction_date', type: 'date' })
  transactionDate: string;

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
