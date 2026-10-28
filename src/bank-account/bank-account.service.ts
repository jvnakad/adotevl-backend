import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BankAccount } from './bank-account.entity';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { PaginationDto } from '../common/pagination.dto';
import { paginate } from '../common/paginate.helper';

@Injectable()
export class BankAccountService {
  constructor(
    @InjectRepository(BankAccount)
    private readonly bankAccountRepository: Repository<BankAccount>,
  ) {}

  async create(dto: CreateBankAccountDto, organizationId: string) {
    // A organização é sempre a do usuário autenticado (o DTO não a aceita)
    const bankAccount = this.bankAccountRepository.create({ ...dto, organizationId });
    return this.bankAccountRepository.save(bankAccount);
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

  async update(id: string, dto: Partial<CreateBankAccountDto>, organizationId: string) {
    await this.findOne(id, organizationId);
    await this.bankAccountRepository.update({ id, organizationId }, dto);
    return this.findOne(id, organizationId);
  }

  async remove(id: string, organizationId: string) {
    await this.findOne(id, organizationId);
    await this.bankAccountRepository.update({ id, organizationId }, { isActive: false });
  }
}
