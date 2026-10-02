import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { Organization } from '../src/organization/organization.entity';
import { Profile } from '../src/profile/profile.entity';
import { User } from '../src/user/user.entity';
import { Pet } from '../src/pet/pet.entity';
import { PetPhoto } from '../src/pet/pet-photo.entity';
import { MedicalRecord } from '../src/medical-record/medical-record.entity';
import { Team } from '../src/team/team.entity';
import { Volunteer } from '../src/volunteer/volunteer.entity';
import { Campaign } from '../src/campaign/campaign.entity';
import { FinancialEntry } from '../src/financial/financial-entry.entity';
import { FinancialExpense } from '../src/financial/financial-expense.entity';
import { Partner } from '../src/partner/partner.entity';
import { BankAccount } from '../src/bank-account/bank-account.entity';
import { OrganizationAddress } from '../src/organization-address/organization-address.entity';
import { OrganizationModule } from '../src/organization/organization.module';
import { ProfileModule } from '../src/profile/profile.module';
import { UserModule } from '../src/user/user.module';
import { AuthModule } from '../src/auth/auth.module';
import { PetModule } from '../src/pet/pet.module';
import { MedicalRecordModule } from '../src/medical-record/medical-record.module';
import { TeamModule } from '../src/team/team.module';
import { VolunteerModule } from '../src/volunteer/volunteer.module';
import { CampaignModule } from '../src/campaign/campaign.module';
import { FinancialModule } from '../src/financial/financial.module';
import { PartnerModule } from '../src/partner/partner.module';
import { BankAccountModule } from '../src/bank-account/bank-account.module';
import { OrganizationAddressModule } from '../src/organization-address/organization-address.module';
import { AdoptionForm } from '../src/adoption-form/adoption-form.entity';
import { AdoptionFormPhoto } from '../src/adoption-form/adoption-form-photo.entity';
import { AdoptionFormModule } from '../src/adoption-form/adoption-form.module';
import { AdoptionHistoryEvent } from '../src/adoption-history/adoption-history.entity';
import { AdoptionHistoryModule } from '../src/adoption-history/adoption-history.module';
import { AdoptionContract } from '../src/adoption-contract/adoption-contract.entity';
import { AdoptionContractModule } from '../src/adoption-contract/adoption-contract.module';
import { MailService } from '../src/mail/mail.service';
import { StorageService } from '../src/storage/storage.service';

class MockMailService {
  async sendConfirmationEmail() {}
  async sendApprovalEmail() {}
  async sendPasswordResetEmail() {}
}

@Global()
@Module({
  providers: [{ provide: MailService, useClass: MockMailService }],
  exports: [MailService],
})
class MockMailModule {}

export class MockStorageService {
  async upload(path: string) {
    return `https://storage.test/pet-photos/${path}`;
  }
  async remove() {}
  async uploadPrivate() {}
  async removePrivate() {}
  async getSignedUrls(paths: string[]) {
    return Object.fromEntries(paths.map((path) => [path, `https://storage.test/signed/${path}`]));
  }
}

@Global()
@Module({
  providers: [{ provide: StorageService, useClass: MockStorageService }],
  exports: [StorageService],
})
class MockStorageModule {}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      entities: [
        Organization, Profile, User, Pet, PetPhoto, MedicalRecord, Team, Volunteer,
        Campaign, FinancialEntry, FinancialExpense, Partner, BankAccount, OrganizationAddress, AdoptionForm, AdoptionFormPhoto,
        AdoptionHistoryEvent, AdoptionContract,
      ],
      synchronize: true,
      ssl: process.env.DATABASE_URL?.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
    }),
    OrganizationModule,
    ProfileModule,
    UserModule,
    AuthModule,
    PetModule,
    MedicalRecordModule,
    TeamModule,
    VolunteerModule,
    CampaignModule,
    FinancialModule,
    PartnerModule,
    BankAccountModule,
    OrganizationAddressModule,
    AdoptionFormModule,
    AdoptionHistoryModule,
    AdoptionContractModule,
    MockMailModule,
    MockStorageModule,
  ],
})
export class TestAppModule {}
