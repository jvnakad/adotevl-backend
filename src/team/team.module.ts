import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Team } from './team.entity';
import { TeamPermission } from './team-permission.entity';
import { TeamService } from './team.service';
import { TeamController } from './team.controller';
import { TeamMembershipService } from './team-membership.service';
import { AccessMigrationService } from './access-migration.service';
import { Volunteer } from '../volunteer/volunteer.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Team, TeamPermission, Volunteer])],
  controllers: [TeamController],
  providers: [TeamService, TeamMembershipService, AccessMigrationService],
  exports: [TeamService, TeamMembershipService],
})
export class TeamModule {}
