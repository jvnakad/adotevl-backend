import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BankAccount } from './bank-account.entity';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';

@Injectable()
export class BankAccountService {
  constructor(
    @InjectRepository(BankAccount)
    private readonly bankAccountRepository: Repository<BankAccount>,
  ) {}

  async create(dto: CreateBankAccountDto) {
    const bankAccount = this.bankAccountRepository.create(dto);
    return this.bankAccountRepository.save(bankAccount);
  }

  async findAll(organizationId?: string) {
    if (organizationId) {
      return this.bankAccountRepository.find({ where: { organizationId } });
    }
    return this.bankAccountRepository.find();
  }

  async findOne(id: string) {
    return this.bankAccountRepository.findOne({ where: { id } });
  }

  async update(id: string, dto: Partial<CreateBankAccountDto>) {
    await this.bankAccountRepository.update(id, dto);
    return this.bankAccountRepository.findOne({ where: { id } });
  }

  async remove(id: string) {
    await this.bankAccountRepository.update(id, { isActive: false });
  }
}
