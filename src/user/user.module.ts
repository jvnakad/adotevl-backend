import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { User } from './user.entity';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { Profile } from '../profile/profile.entity';
import { Organization } from '../organization/organization.entity';
import { TeamModule } from '../team/team.module';
import { VolunteerApplication } from '../volunteer-application/volunteer-application.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Profile, Organization, VolunteerApplication]),
    TeamModule,
    // Cadastros públicos: SIGNUP_RATE_LIMIT por minuto por IP (ThrottlerGuard só nas rotas de cadastro)
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: Number(process.env.SIGNUP_RATE_LIMIT) || 5 }]),
  ],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
