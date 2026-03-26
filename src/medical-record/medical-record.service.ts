import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MedicalRecord } from './medical-record.entity';
import { CreateMedicalRecordDto } from './dto/create-medical-record.dto';
import { PaginationDto } from '../common/pagination.dto';
import { paginate } from '../common/paginate.helper';

@Injectable()
export class MedicalRecordService {
  constructor(
    @InjectRepository(MedicalRecord)
    private readonly medicalRecordRepository: Repository<MedicalRecord>,
  ) {}

  async create(dto: CreateMedicalRecordDto, createdBy: string = null) {
    const record = this.medicalRecordRepository.create({ ...dto, createdBy, updatedBy: createdBy });
    return this.medicalRecordRepository.save(record);
  }

  async findByPet(petId: string, pagination: PaginationDto) {
    return paginate(this.medicalRecordRepository, pagination, { petId, isActive: true });
  }

  async findOne(id: string) {
    const record = await this.medicalRecordRepository.findOne({ where: { id } });
    if (!record) throw new NotFoundException('Registro médico não encontrado.');
    return record;
  }
}
