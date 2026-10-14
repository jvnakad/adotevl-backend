import { Entity, PrimaryGeneratedColumn, Column, OneToOne, JoinColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { User } from '../user/user.entity';
import {
  DayPeriod,
  DebtAction,
  InterestArea,
  Loyalty,
  PressureHandling,
  ReferralSource,
  RoadkillAction,
  ShelterVisit,
  StrayAnimalsFeeling,
  StressReaction,
  Tool,
} from './volunteer-application.options';

/** Questionário do voluntário fixo, respondido no cadastro (1 por usuário). */
@Entity('volunteer_applications')
export class VolunteerApplication {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id', unique: true })
  userId: string;

  @Column()
  city: string;

  @Column()
  neighborhood: string;

  @Column({ name: 'referral_sources', type: 'enum', enum: ReferralSource, array: true })
  referralSources: ReferralSource[];

  @Column({ name: 'referral_other', type: 'varchar', nullable: true })
  referralOther: string | null;

  @Column({ name: 'interest_areas', type: 'enum', enum: InterestArea, array: true })
  interestAreas: InterestArea[];

  @Column({ name: 'interest_other', type: 'varchar', nullable: true })
  interestOther: string | null;

  @Column({ name: 'about_you', type: 'text' })
  aboutYou: string;

  @Column({ name: 'strength_weakness', type: 'text' })
  strengthWeakness: string;

  @Column({ name: 'unpaid_work_feeling', type: 'text' })
  unpaidWorkFeeling: string;

  @Column({ name: 'stray_animals_feeling', type: 'enum', enum: StrayAnimalsFeeling })
  strayAnimalsFeeling: StrayAnimalsFeeling;

  @Column({ type: 'enum', enum: Loyalty })
  loyalty: Loyalty;

  @Column({ name: 'witnessed_abuse' })
  witnessedAbuse: boolean;

  @Column({ name: 'pressure_handling', type: 'enum', enum: PressureHandling })
  pressureHandling: PressureHandling;

  @Column({ name: 'stress_reaction', type: 'enum', enum: StressReaction })
  stressReaction: StressReaction;

  @Column({ name: 'roadkill_actions', type: 'enum', enum: RoadkillAction, array: true })
  roadkillActions: RoadkillAction[];

  @Column({ name: 'emergency_rescue_help', type: 'text' })
  emergencyRescueHelp: string;

  @Column({ name: 'debt_actions', type: 'enum', enum: DebtAction, array: true })
  debtActions: DebtAction[];

  @Column({ name: 'available_periods', type: 'enum', enum: DayPeriod, array: true })
  availablePeriods: DayPeriod[];

  @Column({ type: 'enum', enum: Tool, array: true })
  tools: Tool[];

  @Column({ name: 'shelter_visit', type: 'enum', enum: ShelterVisit })
  shelterVisit: ShelterVisit;

  @Column({ name: 'accepts_interview' })
  acceptsInterview: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
