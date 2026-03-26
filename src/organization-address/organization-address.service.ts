import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrganizationAddress } from './organization-address.entity';
import { CreateOrganizationAddressDto } from './dto/create-organization-address.dto';

@Injectable()
export class OrganizationAddressService {
  constructor(
    @InjectRepository(OrganizationAddress)
    private readonly addressRepository: Repository<OrganizationAddress>,
  ) {}

  async create(dto: CreateOrganizationAddressDto) {
    const address = this.addressRepository.create(dto);
    return this.addressRepository.save(address);
  }

  async findByOrganization(organizationId: string) {
    return this.addressRepository.find({ where: { organizationId } });
  }

  async findOne(id: string) {
    return this.addressRepository.findOne({ where: { id } });
  }

  async update(id: string, dto: Partial<CreateOrganizationAddressDto>) {
    await this.addressRepository.update(id, dto);
    return this.addressRepository.findOne({ where: { id } });
  }

  async remove(id: string) {
    await this.addressRepository.update(id, { isActive: false });
  }
}
