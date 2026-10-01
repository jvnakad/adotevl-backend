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
import { AdoptionFormPhoto } from './adoption-form-photo.entity';

export enum AdoptionFormStatus {
  PENDENTE = 'PENDENTE',
  EM_ANALISE = 'EM_ANALISE',
  APROVADO = 'APROVADO',
  REPROVADO = 'REPROVADO',
}

// Ficha preenchida no formulário público de adoção (/adocao do front)
@Entity('adoption_forms')
export class AdoptionForm {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Etapa 1 — Sobre você
  @Column({ name: 'full_name' })
  fullName: string;

  @Column()
  email: string;

  @Column({ name: 'birth_date', type: 'date' })
  birthDate: Date;

  @Column()
  cpf: string;

  @Column()
  phone: string;

  @Column({ name: 'phone_is_whatsapp', default: false })
  phoneIsWhatsapp: boolean;

  @Column()
  occupation: string;

  @Column({ name: 'zip_code' })
  zipCode: string;

  @Column()
  street: string;

  @Column()
  number: string;

  @Column({ nullable: true })
  complement: string;

  @Column()
  neighborhood: string;

  @Column()
  city: string;

  @Column()
  state: string;

  // Etapa 2 — Animais em casa
  @Column({ name: 'has_pets' })
  hasPets: string;

  @Column({ name: 'pets_count', type: 'int', default: 0 })
  petsCount: number;

  @Column({ name: 'pets_description', type: 'text', nullable: true })
  petsDescription: string;

  @Column({ name: 'pets_neutered', nullable: true })
  petsNeutered: string;

  @Column({ name: 'pets_not_neutered_reason', type: 'text', nullable: true })
  petsNotNeuteredReason: string;

  @Column({ name: 'knows_neutering_importance' })
  knowsNeuteringImportance: string;

  @Column({ name: 'pets_vaccines_up_to_date' })
  petsVaccinesUpToDate: string;

  @Column({ name: 'cat_fiv_felv_tested' })
  catFivFelvTested: string;

  // Etapa 3 — O animal que você quer
  @Column({ name: 'aware_of_adaptation_period' })
  awareOfAdaptationPeriod: string;

  @Column({ name: 'desired_animal', type: 'text' })
  desiredAnimal: string;

  @Column({ name: 'saw_ad_on' })
  sawAdOn: string;

  @Column({ name: 'saw_ad_on_other', nullable: true })
  sawAdOnOther: string;

  @Column({ name: 'can_afford_care' })
  canAffordCare: string;

  @Column({ name: 'intended_food', type: 'text' })
  intendedFood: string;

  @Column({ name: 'has_trusted_clinic' })
  hasTrustedClinic: string;

  @Column({ name: 'trusted_clinic_name', nullable: true })
  trustedClinicName: string;

  // Etapa 4 — Sua casa
  @Column({ name: 'residence_type' })
  residenceType: string;

  @Column({ name: 'condo_pet_policy', type: 'text', nullable: true })
  condoPetPolicy: string;

  @Column({ name: 'windows_screened' })
  windowsScreened: string;

  @Column({ name: 'housing_ownership' })
  housingOwnership: string;

  @Column({ name: 'housing_ownership_other', nullable: true })
  housingOwnershipOther: string;

  @Column({ name: 'adults_count', type: 'int' })
  adultsCount: number;

  @Column({ name: 'children_count', type: 'int', default: 0 })
  childrenCount: number;

  @Column({ name: 'children_ages', nullable: true })
  childrenAges: string;

  // Etapa 5 — Rotina e família
  @Column({ name: 'everyone_agrees' })
  everyoneAgrees: string;

  @Column({ name: 'disagreement_plan', type: 'text' })
  disagreementPlan: string;

  @Column({ name: 'hours_alone_per_day', type: 'int' })
  hoursAlonePerDay: number;

  @Column({ name: 'caretaker_when_traveling', type: 'text' })
  caretakerWhenTraveling: string;

  @Column({ name: 'pregnancy_opinion', type: 'text' })
  pregnancyOpinion: string;

  @Column({ name: 'plans_to_move' })
  plansToMove: string;

  @Column({ name: 'move_animal_plan', type: 'text', nullable: true })
  moveAnimalPlan: string;

  @Column({ name: 'someone_allergic' })
  someoneAllergic: string;

  @Column({ name: 'allergy_plan', type: 'text' })
  allergyPlan: string;

  // Etapa 6 — Histórico
  @Column({ name: 'has_surrendered_pet' })
  hasSurrenderedPet: string;

  @Column({ name: 'surrender_details', type: 'text', nullable: true })
  surrenderDetails: string;

  @Column({ name: 'has_lost_pet_outside' })
  hasLostPetOutside: string;

  @Column({ name: 'lost_pet_details', type: 'text', nullable: true })
  lostPetDetails: string;

  @Column({ name: 'had_recent_pet_death' })
  hadRecentPetDeath: string;

  @Column({ name: 'recent_death_details', type: 'text', nullable: true })
  recentDeathDetails: string;

  // Etapa 7 — Compromisso
  @Column({ name: 'aware_of_longevity' })
  awareOfLongevity: string;

  @Column({ name: 'will_report_changes' })
  willReportChanges: string;

  @Column({ name: 'will_not_rehome_without_notice' })
  willNotRehomeWithoutNotice: string;

  @Column({ name: 'ideal_animal', type: 'text' })
  idealAnimal: string;

  @Column({ name: 'thinking_since' })
  thinkingSince: string;

  @Column({ name: 'aware_of_evaluation_process' })
  awareOfEvaluationProcess: string;

  @Column({ name: 'agrees_with_terms' })
  agreesWithTerms: string;

  @Column({ name: 'declares_truthful' })
  declaresTruthful: string;

  @OneToMany(() => AdoptionFormPhoto, (photo) => photo.adoptionForm)
  fotos: AdoptionFormPhoto[];

  // Avaliação pela equipe
  @Column({ type: 'enum', enum: AdoptionFormStatus, default: AdoptionFormStatus.PENDENTE })
  status: AdoptionFormStatus;

  @Column({ name: 'review_notes', type: 'text', nullable: true })
  reviewNotes: string;

  @Column({ name: 'reviewed_by', nullable: true })
  reviewedBy: string;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt: Date;

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
