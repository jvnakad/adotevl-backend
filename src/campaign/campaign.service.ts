import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Campaign } from './campaign.entity';
import { CreateCampaignDto } from './dto/create-campaign.dto';

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

  async findAll(organizationId?: string) {
    if (organizationId) {
      return this.campaignRepository.find({ where: { organizationId, isActive: true } });
    }
    return this.campaignRepository.find({ where: { isActive: true } });
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
