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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      entities: [Organization, Profile, User, Pet, MedicalRecord],
      synchronize: true,
      ssl: { rejectUnauthorized: false },
    }),
    OrganizationModule,
    ProfileModule,
    UserModule,
    AuthModule,
    PetModule,
    MedicalRecordModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
