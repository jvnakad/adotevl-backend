import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Pet } from './pet.entity';
import { CreatePetDto } from './dto/create-pet.dto';

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

  async findAll(organizationId?: string) {
    if (organizationId) {
      return this.petRepository.find({ where: { organizationId, isActive: true } });
    }
    return this.petRepository.find({ where: { isActive: true } });
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
