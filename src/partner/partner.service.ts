import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Partner } from './partner.entity';
import { CreatePartnerDto } from './dto/create-partner.dto';

@Injectable()
export class PartnerService {
  constructor(
    @InjectRepository(Partner)
    private readonly partnerRepository: Repository<Partner>,
  ) {}

  async create(dto: CreatePartnerDto) {
    const partner = this.partnerRepository.create(dto);
    return this.partnerRepository.save(partner);
  }

  async findAll() {
    return this.partnerRepository.find();
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
