import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Pet } from './pet.entity';
import { CreatePetDto } from './dto/create-pet.dto';
import { PaginationDto } from '../common/pagination.dto';
import { paginate } from '../common/paginate.helper';

@Injectable()
export class PetService {
  constructor(
    @InjectRepository(Pet)
    private readonly petRepository: Repository<Pet>,
  ) {}

  async create(dto: CreatePetDto, createdBy: string = null) {
    const pet = this.petRepository.create({ ...dto, createdBy, updatedBy: createdBy });
    return this.petRepository.save(pet);
  }

  async findAll(pagination: PaginationDto, filters: { organizationId?: string; species?: string; sex?: string; size?: string; castration?: string } = {}) {
    const where: any = { isActive: true };
    if (filters.organizationId) where.organizationId = filters.organizationId;
    if (filters.species) where.species = filters.species;
    if (filters.sex) where.sex = filters.sex;
    if (filters.size) where.size = filters.size;
    if (filters.castration !== undefined) where.castration = filters.castration === 'true';
    return paginate(this.petRepository, pagination, where);
  }

  async findOne(id: string) {
    const pet = await this.petRepository.findOne({ where: { id } });
    if (!pet) throw new NotFoundException('Pet não encontrado.');
    return pet;
  }

  async update(id: string, dto: Partial<CreatePetDto>, updatedBy: string = null) {
    await this.petRepository.update(id, { ...dto, updatedBy });
    return this.findOne(id);
  }
}
