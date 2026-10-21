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
import { AdoptionHistoryModule } from './adoption-history/adoption-history.module';
import { AdoptionHistoryEvent } from './adoption-history/adoption-history.entity';
import { AdoptionContractModule } from './adoption-contract/adoption-contract.module';
import { VolunteerShift } from './volunteer-schedule/volunteer-shift.entity';
import { ScheduleLock } from './volunteer-schedule/schedule-lock.entity';
import { ScheduleAccessCode } from './volunteer-schedule/schedule-access-code.entity';
import { VolunteerScheduleModule } from './volunteer-schedule/volunteer-schedule.module';
import { VolunteerApplication } from './volunteer-application/volunteer-application.entity';
import { AdoptionContract } from './adoption-contract/adoption-contract.entity';
import { AutentiqueModule } from './autentique/autentique.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { TeamPermission } from './team/team-permission.entity';
import { AccessModule } from './access/access.module';
import { ProductType } from './stock/product-type.entity';
import { Product } from './stock/product.entity';
import { StockHistoryEvent } from './stock/stock-history.entity';
import { NullByteModule } from './common/null-byte.middleware';
import { StockModule } from './stock/stock.module';
import { ScheduleInstitution } from './volunteer-schedule/schedule-institution.entity';
import { MarketingModule } from './marketing/marketing.module';
import { RealtimeModule } from './realtime/realtime.module';
import { NotificationModule } from './notification/notification.module';
import { Notification } from './notification/notification.entity';
import { MarketingList } from './marketing/entities/marketing-list.entity';
import { MarketingLabel } from './marketing/entities/marketing-label.entity';
import { MarketingCard } from './marketing/entities/marketing-card.entity';
import { MarketingCardMember } from './marketing/entities/marketing-card-member.entity';
import { MarketingCardLabel } from './marketing/entities/marketing-card-label.entity';
import { MarketingCardTask } from './marketing/entities/marketing-card-task.entity';
import { MarketingCardAttachment } from './marketing/entities/marketing-card-attachment.entity';
import { MarketingCardComment } from './marketing/entities/marketing-card-comment.entity';
import { MarketingHistoryEvent } from './marketing/entities/marketing-history-event.entity';

@Module({
  imports: [
    // .env.local (ambiente local) tem precedência sobre o .env
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env.local', '.env'] }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      entities: [Organization, Profile, User, Pet, PetPhoto, MedicalRecord, Team, TeamPermission, Volunteer, Campaign, FinancialEntry, FinancialExpense, Partner, BankAccount, OrganizationAddress, AdoptionForm, AdoptionFormPhoto, AdoptionHistoryEvent, AdoptionContract, VolunteerApplication, VolunteerShift, ScheduleLock, ScheduleAccessCode, ScheduleInstitution, ProductType, Product, StockHistoryEvent, MarketingList, MarketingLabel, MarketingCard, MarketingCardMember, MarketingCardLabel, MarketingCardTask, MarketingCardAttachment, MarketingCardComment, MarketingHistoryEvent, Notification],
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
    AccessModule,
    VolunteerModule,
    CampaignModule,
    FinancialModule,
    PartnerModule,
    BankAccountModule,
    OrganizationAddressModule,
    MailModule,
    StorageModule,
    AdoptionFormModule,
    AdoptionHistoryModule,
    AdoptionContractModule,
    VolunteerScheduleModule,
    StockModule,
    RealtimeModule,
    NotificationModule,
    MarketingModule,
    NullByteModule,
    AutentiqueModule,
    WebhooksModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
