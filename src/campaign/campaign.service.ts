import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Campaign } from './campaign.entity';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { PaginationDto } from '../common/pagination.dto';
import { paginate } from '../common/paginate.helper';

@Injectable()
export class CampaignService {
  constructor(
    @InjectRepository(Campaign)
    private readonly campaignRepository: Repository<Campaign>,
  ) {}

  async create(dto: CreateCampaignDto, createdBy: string = null) {
    const campaign = this.campaignRepository.create({ ...dto, createdBy, updatedBy: createdBy });
    return this.campaignRepository.save(campaign);
  }

  async findAll(pagination: PaginationDto, organizationId?: string) {
    const where = organizationId ? { organizationId, isActive: true } : { isActive: true };
    return paginate(this.campaignRepository, pagination, where);
  }

  async findOne(id: string) {
    const campaign = await this.campaignRepository.findOne({ where: { id } });
    if (!campaign) throw new NotFoundException('Campanha não encontrada.');
    return campaign;
  }

  async update(id: string, dto: Partial<CreateCampaignDto>, updatedBy: string = null) {
    await this.campaignRepository.update(id, { ...dto, updatedBy });
    return this.findOne(id);
  }
}
