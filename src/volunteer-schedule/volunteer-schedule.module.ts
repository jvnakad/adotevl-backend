import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VolunteerShift } from './volunteer-shift.entity';
import { ScheduleLock } from './schedule-lock.entity';
import { ScheduleAccessCode } from './schedule-access-code.entity';
import { ScheduleInstitution } from './schedule-institution.entity';
import { User } from '../user/user.entity';
import { VolunteerScheduleService } from './volunteer-schedule.service';
import { ScheduleAccessService } from './schedule-access.service';
import { VolunteerScheduleController } from './volunteer-schedule.controller';
import { PublicScheduleController } from './public-schedule.controller';
import { ScheduleInstitutionService } from './schedule-institution.service';
import { ScheduleInstitutionController } from './schedule-institution.controller';

// AccessModule e ThrottlerModule (UserModule) são globais
@Module({
  imports: [TypeOrmModule.forFeature([VolunteerShift, ScheduleLock, ScheduleAccessCode, ScheduleInstitution, User])],
  controllers: [VolunteerScheduleController, ScheduleInstitutionController, PublicScheduleController],
  providers: [VolunteerScheduleService, ScheduleAccessService, ScheduleInstitutionService],
})
export class VolunteerScheduleModule {}
