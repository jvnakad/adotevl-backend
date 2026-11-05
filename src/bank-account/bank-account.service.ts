import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BankAccount } from './bank-account.entity';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { PaginationDto } from '../common/pagination.dto';
import { paginate } from '../common/paginate.helper';
import { ScreenRealtimeService, ScreenChangeKind } from '../realtime/screen-realtime.service';
import { Screen } from '../access/access';

@Injectable()
export class BankAccountService {
  constructor(
    @InjectRepository(BankAccount)
    private readonly bankAccountRepository: Repository<BankAccount>,
    @Optional() private readonly screenRealtime?: ScreenRealtimeService,
  ) {}

  // Tempo real: avisa as telas abertas que algo mudou (o front busca de novo pela API). Nunca falha a ação.
  private changed(organizationId: string, kind: ScreenChangeKind, id?: string, actorId?: string | null) {
    return this.screenRealtime?.publish({ screens: Screen.BANK_ACCOUNTS, organizationId, resource: 'bank-account', kind, id, actorId });
  }

  async create(dto: CreateBankAccountDto, organizationId: string, actorId: string = null) {
    // A organização é sempre a do usuário autenticado (o DTO não a aceita)
    const bankAccount = this.bankAccountRepository.create({ ...dto, organizationId });
    const saved = await this.bankAccountRepository.save(bankAccount);
    await this.changed(organizationId, 'created', saved.id, actorId);
    return saved;
  }

  async findAll(pagination: PaginationDto, organizationId?: string) {
    const where = organizationId ? { organizationId } : undefined;
    return paginate(this.bankAccountRepository, pagination, where);
  }

  /** Conta da organização informada; de outra organização responde como inexistente (404). */
  async findOne(id: string, organizationId: string) {
    const account = await this.bankAccountRepository.findOne({ where: { id, organizationId } });
    if (!account) throw new NotFoundException('Conta bancária não encontrada.');
    return account;
  }

  async update(id: string, dto: Partial<CreateBankAccountDto>, organizationId: string, actorId: string = null) {
    await this.findOne(id, organizationId);
    await this.bankAccountRepository.update({ id, organizationId }, dto);
    await this.changed(organizationId, 'updated', id, actorId);
    return this.findOne(id, organizationId);
  }

  async remove(id: string, organizationId: string, actorId: string = null) {
    await this.findOne(id, organizationId);
    await this.bankAccountRepository.update({ id, organizationId }, { isActive: false });
    await this.changed(organizationId, 'deleted', id, actorId);
  }
}
