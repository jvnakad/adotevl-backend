import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Volunteer } from '../volunteer/volunteer.entity';
import { TeamPermission } from '../team/team-permission.entity';
import { AccessService } from './access.service';
import { AccessGuard } from './access.guard';

// Global: qualquer controller usa @UseGuards(JwtAuthGuard, AccessGuard) sem importar o módulo
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Volunteer, TeamPermission])],
  providers: [AccessService, AccessGuard],
  exports: [AccessService, AccessGuard],
})
export class AccessModule {}
