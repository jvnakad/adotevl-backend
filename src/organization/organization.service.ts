import { Injectable, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Organization } from './organization.entity';
import { CreateOrganizationDto } from './dto/create-organization.dto';

@Injectable()
export class OrganizationService {
  constructor(
    @InjectRepository(Organization)
    private readonly organizationRepository: Repository<Organization>,
  ) {}

  async create(dto: CreateOrganizationDto, createdBy: string = null) {
    const existing = await this.organizationRepository.findOne({ where: { cnpj: dto.cnpj } });
    if (existing) {
      throw new ConflictException('Já existe uma organização cadastrada com este CNPJ.');
    }
    const organization = this.organizationRepository.create({
      ...dto,
      isActive: true,
      createdBy,
      updatedBy: createdBy,
    });
    return this.organizationRepository.save(organization);
  }

  async findAll() {
    return this.organizationRepository.find();
  }

  async findOne(id: string) {
    return this.organizationRepository.findOne({ where: { id } });
  }

  async findByCnpj(cnpj: string) {
    return this.organizationRepository.findOne({ where: { cnpj } });
  }
}
