import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Team } from './team.entity';
import { CreateTeamDto } from './dto/create-team.dto';

@Injectable()
export class TeamService {
  constructor(
    @InjectRepository(Team)
    private readonly teamRepository: Repository<Team>,
  ) {}

  async create(dto: CreateTeamDto, createdBy: string = null) {
    const team = this.teamRepository.create({ ...dto, createdBy, updatedBy: createdBy });
    return this.teamRepository.save(team);
  }

  async findAll(organizationId?: string) {
    if (organizationId) {
      return this.teamRepository.find({ where: { organizationId, isActive: true } });
    }
    return this.teamRepository.find({ where: { isActive: true } });
  }

  async findOne(id: string) {
    const team = await this.teamRepository.findOne({ where: { id } });
    if (!team) throw new NotFoundException('Equipe não encontrada.');
    return team;
  }

  async update(id: string, dto: Partial<CreateTeamDto>, updatedBy: string = null) {
    await this.teamRepository.update(id, { ...dto, updatedBy });
    return this.findOne(id);
  }
}
