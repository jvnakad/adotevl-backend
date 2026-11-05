import { Injectable, ConflictException, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Partner } from './partner.entity';
import { CreatePartnerDto } from './dto/create-partner.dto';
import { PaginationDto } from '../common/pagination.dto';
import { paginate } from '../common/paginate.helper';
import { ScreenRealtimeService, ScreenChangeKind } from '../realtime/screen-realtime.service';
import { Screen } from '../access/access';

@Injectable()
export class PartnerService {
  constructor(
    @InjectRepository(Partner)
    private readonly partnerRepository: Repository<Partner>,
    @Optional() private readonly screenRealtime?: ScreenRealtimeService,
  ) {}

  // Tempo real: avisa as telas abertas que algo mudou (o front busca de novo pela API). Nunca falha a ação.
  private changed(organizationId: string, kind: ScreenChangeKind, id?: string, actorId?: string | null) {
    return this.screenRealtime?.publish({ screens: Screen.PARTNERS, organizationId, resource: 'partner', kind, id, actorId });
  }

  async create(dto: CreatePartnerDto, organizationId: string, actorId: string = null) {
    if (dto.document) {
      const docExists = await this.partnerRepository.findOne({ where: { document: dto.document, organizationId } });
      if (docExists) throw new ConflictException('Já existe um parceiro cadastrado com este CPF/CNPJ.');
    }
    if (dto.email) {
      const emailExists = await this.partnerRepository.findOne({ where: { email: dto.email, organizationId } });
      if (emailExists) throw new ConflictException('Já existe um parceiro cadastrado com este e-mail.');
    }
    const partner = this.partnerRepository.create({ ...dto, organizationId });
    const saved = await this.partnerRepository.save(partner);
    await this.changed(organizationId, 'created', saved.id, actorId);
    return saved;
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

  async update(id: string, dto: Partial<CreatePartnerDto>, organizationId: string, actorId: string = null) {
    await this.findOne(id, organizationId);
    await this.partnerRepository.update({ id, organizationId }, dto);
    await this.changed(organizationId, 'updated', id, actorId);
    return this.findOne(id, organizationId);
  }

  async remove(id: string, organizationId: string, actorId: string = null) {
    await this.findOne(id, organizationId);
    await this.partnerRepository.update({ id, organizationId }, { isActive: false });
    await this.changed(organizationId, 'deleted', id, actorId);
  }
}
