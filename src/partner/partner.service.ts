import { Injectable, ConflictException } from '@nestjs/common';
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

  async create(dto: CreatePartnerDto) {
    if (dto.document) {
      const docExists = await this.partnerRepository.findOne({ where: { document: dto.document } });
      if (docExists) throw new ConflictException('Já existe um parceiro cadastrado com este CPF/CNPJ.');
    }
    if (dto.email) {
      const emailExists = await this.partnerRepository.findOne({ where: { email: dto.email } });
      if (emailExists) throw new ConflictException('Já existe um parceiro cadastrado com este e-mail.');
    }
    const partner = this.partnerRepository.create(dto);
    return this.partnerRepository.save(partner);
  }

  async findAll(pagination: PaginationDto) {
    return paginate(this.partnerRepository, pagination);
  }

  async findOne(id: string) {
    return this.partnerRepository.findOne({ where: { id } });
  }

  async update(id: string, dto: Partial<CreatePartnerDto>) {
    await this.partnerRepository.update(id, dto);
    return this.partnerRepository.findOne({ where: { id } });
  }

  async remove(id: string) {
    await this.partnerRepository.update(id, { isActive: false });
  }
}
