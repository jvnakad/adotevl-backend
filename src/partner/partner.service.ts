import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Partner } from './partner.entity';
import { CreatePartnerDto } from './dto/create-partner.dto';
import { PaginationDto } from '../common/pagination.dto';
import { paginate } from '../common/paginate.helper';

@Injectable()
export class PartnerService {
  constructor(
    @InjectRepository(Partner)
    private readonly partnerRepository: Repository<Partner>,
  ) {}

  async create(dto: CreatePartnerDto, organizationId: string) {
    if (dto.document) {
      const docExists = await this.partnerRepository.findOne({ where: { document: dto.document, organizationId } });
      if (docExists) throw new ConflictException('Já existe um parceiro cadastrado com este CPF/CNPJ.');
    }
    if (dto.email) {
      const emailExists = await this.partnerRepository.findOne({ where: { email: dto.email, organizationId } });
      if (emailExists) throw new ConflictException('Já existe um parceiro cadastrado com este e-mail.');
    }
    const partner = this.partnerRepository.create({ ...dto, organizationId });
    return this.partnerRepository.save(partner);
  }

  async findAll(pagination: PaginationDto, organizationId: string) {
    return paginate(this.partnerRepository, pagination, { organizationId });
  }

  /** Parceiro da organização informada; de outra organização responde como inexistente (404). */
  async findOne(id: string, organizationId: string) {
    const partner = await this.partnerRepository.findOne({ where: { id, organizationId } });
    if (!partner) throw new NotFoundException('Parceiro não encontrado.');
    return partner;
  }

  async update(id: string, dto: Partial<CreatePartnerDto>, organizationId: string) {
    await this.findOne(id, organizationId);
    await this.partnerRepository.update({ id, organizationId }, dto);
    return this.findOne(id, organizationId);
  }

  async remove(id: string, organizationId: string) {
    await this.findOne(id, organizationId);
    await this.partnerRepository.update({ id, organizationId }, { isActive: false });
  }
}
