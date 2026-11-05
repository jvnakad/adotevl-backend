import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Volunteer } from '../volunteer/volunteer.entity';
import { TeamPermission } from '../team/team-permission.entity';
import { TeamSystemKey } from '../team/team.entity';
import { ADMIN_PERMISSIONS, UserAccess } from './access';

@Injectable()
export class AccessService {
  constructor(
    @InjectRepository(Volunteer)
    private readonly volunteerRepository: Repository<Volunteer>,
    @InjectRepository(TeamPermission)
    private readonly permissionRepository: Repository<TeamPermission>,
  ) {}

  /** Equipe e permissões do usuário (via volunteers.teamId). null = sem equipe ativa. */
  async forUser(userId: string): Promise<UserAccess | null> {
    if (!userId) return null;
    const volunteer = await this.volunteerRepository.findOne({ where: { userId, isActive: true }, relations: { team: true } });
    const team = volunteer?.team;
    if (!team || !team.isActive) return null;

    const base = { teamId: team.id, teamName: team.name, isAdmin: team.isAdmin };
    if (team.isAdmin) return { ...base, permissions: ADMIN_PERMISSIONS };

    const rows = await this.permissionRepository.find({ where: { teamId: team.id } });
    return { ...base, permissions: Object.fromEntries(rows.map((row) => [row.screen, row.level])) };
  }

  /** Volante = a equipe ativa do usuário é a Voluntário Volante. Vale pela equipe, não pela matriz de permissões dela. */
  async isFloatingVolunteer(userId: string): Promise<boolean> {
    if (!userId) return false;
    const volunteer = await this.volunteerRepository.findOne({ where: { userId, isActive: true }, relations: { team: true } });
    return volunteer?.team?.systemKey === TeamSystemKey.FLOATING_VOLUNTEER;
  }
}
