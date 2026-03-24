import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Volunteer } from './volunteer.entity';
import { CreateVolunteerDto } from './dto/create-volunteer.dto';

@Injectable()
export class VolunteerService {
  constructor(
    @InjectRepository(Volunteer)
    private readonly volunteerRepository: Repository<Volunteer>,
  ) {}

  async create(dto: CreateVolunteerDto, createdBy: string = null) {
    const existing = await this.volunteerRepository.findOne({ where: { userId: dto.userId } });
    if (existing) {
      throw new ConflictException('Este usuário já está vinculado a um voluntário.');
    }
    const volunteer = this.volunteerRepository.create({ ...dto, createdBy, updatedBy: createdBy });
    return this.volunteerRepository.save(volunteer);
  }

  async findAll() {
    return this.volunteerRepository.find({ where: { isActive: true } });
  }

  async findOne(id: string) {
    const volunteer = await this.volunteerRepository.findOne({ where: { id } });
    if (!volunteer) throw new NotFoundException('Voluntário não encontrado.');
    return volunteer;
  }

  async update(id: string, dto: Partial<CreateVolunteerDto>, updatedBy: string = null) {
    await this.volunteerRepository.update(id, { ...dto, updatedBy });
    return this.findOne(id);
  }
}
