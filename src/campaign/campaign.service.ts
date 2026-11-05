import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Campaign } from './campaign.entity';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { PaginationDto } from '../common/pagination.dto';
import { paginate } from '../common/paginate.helper';
import { ScreenRealtimeService, ScreenChangeKind } from '../realtime/screen-realtime.service';
import { Screen } from '../access/access';

@Injectable()
export class CampaignService {
  constructor(
    @InjectRepository(Campaign)
    private readonly campaignRepository: Repository<Campaign>,
    @Optional() private readonly screenRealtime?: ScreenRealtimeService,
  ) {}

  // Tempo real: avisa as telas abertas que algo mudou (o front busca de novo pela API). Nunca falha a ação.
  private changed(organizationId: string, kind: ScreenChangeKind, id?: string, actorId?: string | null) {
    return this.screenRealtime?.publish({ screens: Screen.CAMPAIGNS, organizationId, resource: 'campaign', kind, id, actorId });
  }

  async create(dto: CreateCampaignDto, organizationId: string, createdBy: string = null) {
    // A organização é sempre a do usuário autenticado (o DTO não a aceita)
    const campaign = this.campaignRepository.create({ ...dto, organizationId, createdBy, updatedBy: createdBy });
    const saved = await this.campaignRepository.save(campaign);
    await this.changed(organizationId, 'created', saved.id, createdBy);
    return saved;
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
    await this.changed(organizationId, 'updated', id, updatedBy);
    return this.findOne(id, organizationId);
  }
}
