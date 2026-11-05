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

  async create(dto: CreateCampaignDto, organizationId: string, createdBy: string = null) {
    // A organização é sempre a do usuário autenticado (o DTO não a aceita)
    const campaign = this.campaignRepository.create({ ...dto, organizationId, createdBy, updatedBy: createdBy });
    return this.campaignRepository.save(campaign);
  }

  async findAll(pagination: PaginationDto, organizationId?: string) {
    const where = organizationId ? { organizationId, isActive: true } : { isActive: true };
    return paginate(this.campaignRepository, pagination, where);
  }

  /** Campanha da organização informada; de outra organização responde como inexistente (404). */
  async findOne(id: string, organizationId: string) {
    const campaign = await this.campaignRepository.findOne({ where: { id, organizationId } });
    if (!campaign) throw new NotFoundException('Campanha não encontrada.');
    return campaign;
  }

  async update(id: string, dto: Partial<CreateCampaignDto>, organizationId: string, updatedBy: string = null) {
    await this.findOne(id, organizationId);
    await this.campaignRepository.update({ id, organizationId }, { ...dto, updatedBy });
    return this.findOne(id, organizationId);
  }
}
