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
import { MedicalRecordModule } from './medical-record/medical-record.module';
import { MedicalRecord } from './medical-record/medical-record.entity';
import { TeamModule } from './team/team.module';
import { Team } from './team/team.entity';
import { VolunteerModule } from './volunteer/volunteer.module';
import { Volunteer } from './volunteer/volunteer.entity';
import { CampaignModule } from './campaign/campaign.module';
import { Campaign } from './campaign/campaign.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      entities: [Organization, Profile, User, Pet, MedicalRecord, Team, Volunteer, Campaign],
      synchronize: true,
      ssl: { rejectUnauthorized: false },
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
