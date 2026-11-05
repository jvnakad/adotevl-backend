import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MedicalRecord } from './medical-record.entity';
import { CreateMedicalRecordDto } from './dto/create-medical-record.dto';
import { UpdateMedicalRecordDto } from './dto/update-medical-record.dto';
import { PaginationDto } from '../common/pagination.dto';
import { paginate } from '../common/paginate.helper';
import { ScreenRealtimeService, ScreenChangeKind } from '../realtime/screen-realtime.service';
import { Screen } from '../access/access';

@Injectable()
export class MedicalRecordService {
  constructor(
    @InjectRepository(MedicalRecord)
    private readonly medicalRecordRepository: Repository<MedicalRecord>,
    @Optional() private readonly screenRealtime?: ScreenRealtimeService,
  ) {}

  // Tempo real: avisa as telas abertas que algo mudou (o front busca de novo pela API). Nunca falha a ação.
  private changed(organizationId: string, kind: ScreenChangeKind, id?: string, actorId?: string | null) {
    return this.screenRealtime?.publish({ screens: [Screen.MEDICAL_RECORDS, Screen.PETS], organizationId, resource: 'medical-record', kind, id, actorId });
  }

  async create(dto: CreateMedicalRecordDto, createdBy: string = null, organizationId: string = null) {
    const record = this.medicalRecordRepository.create({ ...dto, createdBy, updatedBy: createdBy });
    const saved = await this.medicalRecordRepository.save(record);
    await this.changed(organizationId, 'created', saved.id, createdBy);
    return saved;
  }

  async findByPet(petId: string, pagination: PaginationDto) {
    return paginate(this.medicalRecordRepository, pagination, { petId, isActive: true });
  }

  async findOne(id: string) {
    const record = await this.medicalRecordRepository.findOne({ where: { id } });
    if (!record) throw new NotFoundException('Registro médico não encontrado.');
    return record;
  }

  async update(id: string, dto: UpdateMedicalRecordDto, updatedBy: string = null, organizationId: string = null) {
    const record = await this.medicalRecordRepository.findOne({ where: { id } });
    if (!record) throw new NotFoundException('Registro médico não encontrado.');
    await this.medicalRecordRepository.update(id, { ...dto, updatedBy });
    await this.changed(organizationId, 'updated', id, updatedBy);
    return this.medicalRecordRepository.findOne({ where: { id } });
  }
}
