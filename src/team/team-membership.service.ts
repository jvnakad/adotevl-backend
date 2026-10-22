import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Team, TeamSystemKey } from './team.entity';
import { Volunteer } from '../volunteer/volunteer.entity';
import { User } from '../user/user.entity';

const LAST_ADMIN = 'A equipe Admin precisa de ao menos um membro ativo.';

/** Vínculo usuário ↔ equipe (via volunteers.teamId), que define o acesso às telas. */
@Injectable()
export class TeamMembershipService {
  constructor(
    @InjectRepository(Team)
    private readonly teamRepository: Repository<Team>,
    @InjectRepository(Volunteer)
    private readonly volunteerRepository: Repository<Volunteer>,
  ) {}

  /** Coloca o usuário na equipe, criando o registro de voluntário se ainda não existir. */
  async assign(user: Pick<User, 'id' | 'fullName' | 'cpf' | 'birthDate' | 'organizationId'>, teamId: string, updatedBy: string) {
    const team = await this.teamRepository.findOne({ where: { id: teamId, organizationId: user.organizationId } });
    if (!team || !team.isActive) throw new BadRequestException('Equipe não encontrada nesta organização.');

    const volunteer = await this.volunteerRepository.findOne({ where: { userId: user.id }, relations: { team: true } });
    if (volunteer?.team?.isAdmin && !team.isAdmin) await this.ensureAdminRemains(volunteer.team.id);

    if (volunteer) {
      await this.volunteerRepository.update(volunteer.id, { teamId, isActive: true, updatedBy });
      return;
    }
    await this.volunteerRepository.save(
      this.volunteerRepository.create({
        userId: user.id,
        name: user.fullName,
        cpf: user.cpf,
        birthDate: user.birthDate,
        teamId,
        isActive: true,
        createdBy: updatedBy,
        updatedBy,
      }),
    );
  }

  /** Antes de desativar/rejeitar um usuário: não pode ser o último membro da equipe Admin. */
  async ensureNotLastAdmin(userId: string) {
    const volunteer = await this.volunteerRepository.findOne({ where: { userId, isActive: true }, relations: { team: true } });
    if (volunteer?.team?.isAdmin) await this.ensureAdminRemains(volunteer.team.id);
  }

  /** Equipe ativa de cada usuário (para listar voluntários com a equipe). */
  async teamsOf(userIds: string[]) {
    const teams = new Map<string, { id: string; name: string; isAdmin: boolean; systemKey: TeamSystemKey | null }>();
    if (!userIds.length) return teams;
    const volunteers = await this.volunteerRepository.find({ where: { userId: In(userIds), isActive: true }, relations: { team: true } });
    volunteers.forEach((volunteer) => volunteer.team && teams.set(volunteer.userId, { id: volunteer.team.id, name: volunteer.team.name, isAdmin: volunteer.team.isAdmin, systemKey: volunteer.team.systemKey ?? null }));
    return teams;
  }

  async userIdsOfTeam(teamId: string) {
    const volunteers = await this.volunteerRepository.find({ where: { teamId, isActive: true } });
    return volunteers.map((volunteer) => volunteer.userId);
  }

  private async ensureAdminRemains(adminTeamId: string) {
    const members = await this.volunteerRepository.count({
      where: { teamId: adminTeamId, isActive: true, user: { isActive: true, isApproved: true } },
      relations: { user: true },
    });
    if (members <= 1) throw new BadRequestException(LAST_ADMIN);
  }
}
