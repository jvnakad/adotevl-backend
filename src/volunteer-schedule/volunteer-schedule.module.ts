import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VolunteerShift } from './volunteer-shift.entity';
import { ScheduleLock } from './schedule-lock.entity';
import { ScheduleAccessCode } from './schedule-access-code.entity';
import { User } from '../user/user.entity';
import { VolunteerScheduleService } from './volunteer-schedule.service';
import { ScheduleAccessService } from './schedule-access.service';
import { VolunteerScheduleController } from './volunteer-schedule.controller';
import { PublicScheduleController } from './public-schedule.controller';

// AccessModule e ThrottlerModule (UserModule) são globais
@Module({
  imports: [TypeOrmModule.forFeature([VolunteerShift, ScheduleLock, ScheduleAccessCode, User])],
  controllers: [VolunteerScheduleController, PublicScheduleController],
  providers: [VolunteerScheduleService, ScheduleAccessService],
})
export class VolunteerScheduleModule {}
