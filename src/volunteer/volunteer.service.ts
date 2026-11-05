import { Injectable, NotFoundException, ConflictException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Volunteer } from './volunteer.entity';
import { CreateVolunteerDto } from './dto/create-volunteer.dto';
import { UpdateVolunteerDto } from './dto/update-volunteer.dto';
import { normalizeCpf, normalizePersonName } from '../common/validation/person';
import { PaginationDto } from '../common/pagination.dto';
import { paginate } from '../common/paginate.helper';
import { ScreenRealtimeService, ScreenChangeKind } from '../realtime/screen-realtime.service';
import { Screen } from '../access/access';

/** O ValidationPipe global não grava a normalização no body: nome e CPF vão limpos para o banco. */
const normalizedPerson = (dto: UpdateVolunteerDto) => ({
  ...(dto.name !== undefined && { name: normalizePersonName(dto.name) as string }),
  ...(dto.cpf !== undefined && { cpf: normalizeCpf(dto.cpf) as string }),
});

@Injectable()
export class VolunteerService {
  constructor(
    @InjectRepository(Volunteer)
    private readonly volunteerRepository: Repository<Volunteer>,
    @Optional() private readonly screenRealtime?: ScreenRealtimeService,
  ) {}

  // Tempo real: avisa as telas abertas que algo mudou (o front busca de novo pela API). Nunca falha a ação.
  private changed(organizationId: string, kind: ScreenChangeKind, id?: string, actorId?: string | null) {
    return this.screenRealtime?.publish({ screens: Screen.VOLUNTEERS, organizationId, resource: 'volunteer', kind, id, actorId });
  }

  async create(dto: CreateVolunteerDto, createdBy: string = null, organizationId: string = null) {
    const existing = await this.volunteerRepository.findOne({ where: { userId: dto.userId } });
    if (existing) {
      throw new ConflictException('Este usuário já está vinculado a um voluntário.');
    }
    const volunteer = this.volunteerRepository.create({ ...dto, ...normalizedPerson(dto), createdBy, updatedBy: createdBy });
    const saved = await this.volunteerRepository.save(volunteer);
    await this.changed(organizationId, 'created', saved.id, createdBy);
    return saved;
  }

  async findAll(pagination: PaginationDto, filters: { teamId?: string } = {}) {
    const where: any = { isActive: true };
    if (filters.teamId) where.teamId = filters.teamId;
    return paginate(this.volunteerRepository, pagination, where);
  }

  async findOne(id: string) {
    const volunteer = await this.volunteerRepository.findOne({ where: { id } });
    if (!volunteer) throw new NotFoundException('Voluntário não encontrado.');
    return volunteer;
  }

  async update(id: string, dto: UpdateVolunteerDto, updatedBy: string = null, organizationId: string = null) {
    await this.volunteerRepository.update(id, { ...dto, ...normalizedPerson(dto), updatedBy });
    await this.changed(organizationId, 'updated', id, updatedBy);
    return this.findOne(id);
  }
}
