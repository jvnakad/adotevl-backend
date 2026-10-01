import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { OrganizationModule } from './organization/organization.module';
import { Organization } from './organization/organization.entity';
import { ProfileModule } from './profile/profile.module';
import { Profile } from './profile/profile.entity';
import { UserModule } from './user/user.module';
import { User } from './user/user.entity';
import { AuthModule } from './auth/auth.module';
import { PetModule } from './pet/pet.module';
import { Pet } from './pet/pet.entity';
import { PetPhoto } from './pet/pet-photo.entity';
import { MedicalRecordModule } from './medical-record/medical-record.module';
import { MedicalRecord } from './medical-record/medical-record.entity';
import { TeamModule } from './team/team.module';
import { Team } from './team/team.entity';
import { VolunteerModule } from './volunteer/volunteer.module';
import { Volunteer } from './volunteer/volunteer.entity';
import { CampaignModule } from './campaign/campaign.module';
import { Campaign } from './campaign/campaign.entity';
import { FinancialModule } from './financial/financial.module';
import { FinancialEntry } from './financial/financial-entry.entity';
import { FinancialExpense } from './financial/financial-expense.entity';
import { PartnerModule } from './partner/partner.module';
import { Partner } from './partner/partner.entity';
import { BankAccountModule } from './bank-account/bank-account.module';
import { BankAccount } from './bank-account/bank-account.entity';
import { OrganizationAddressModule } from './organization-address/organization-address.module';
import { OrganizationAddress } from './organization-address/organization-address.entity';
import { MailModule } from './mail/mail.module';
import { StorageModule } from './storage/storage.module';
import { AdoptionFormModule } from './adoption-form/adoption-form.module';
import { AdoptionForm } from './adoption-form/adoption-form.entity';
import { AdoptionFormPhoto } from './adoption-form/adoption-form-photo.entity';

@Module({
  imports: [
    // .env.local (ambiente local) tem precedência sobre o .env
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env.local', '.env'] }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      entities: [Organization, Profile, User, Pet, PetPhoto, MedicalRecord, Team, Volunteer, Campaign, FinancialEntry, FinancialExpense, Partner, BankAccount, OrganizationAddress, AdoptionForm, AdoptionFormPhoto],
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
    MailModule,
    StorageModule,
    AdoptionFormModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
