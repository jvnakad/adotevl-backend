import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { FinancialEntry } from './financial-entry.entity';
import { FinancialExpense } from './financial-expense.entity';
import { BankAccount } from '../bank-account/bank-account.entity';
import { CreateFinancialEntryDto } from './dto/create-financial-entry.dto';
import { CreateFinancialExpenseDto } from './dto/create-financial-expense.dto';
import { UpdateFinancialEntryDto } from './dto/update-financial-entry.dto';
import { UpdateFinancialExpenseDto } from './dto/update-financial-expense.dto';
import { PaginationDto } from '../common/pagination.dto';
import { paginate } from '../common/paginate.helper';

export interface FinancialEntryFilters {
  startDate?: string;
  endDate?: string;
  campaignId?: string;
}

@Injectable()
export class FinancialService {
  constructor(
    @InjectRepository(FinancialEntry)
    private readonly entryRepository: Repository<FinancialEntry>,
    @InjectRepository(FinancialExpense)
    private readonly expenseRepository: Repository<FinancialExpense>,
  ) {}

  /** Conta bancária inexistente vira 404 em vez de violação de FK (500). */
  private async assertBankAccount(bankAccountId?: string) {
    if (!bankAccountId) return;
    const found = await this.entryRepository.manager.findOne(BankAccount, { where: { id: bankAccountId }, select: { id: true } });
    if (!found) throw new NotFoundException('Conta bancária não encontrada.');
  }

  async createEntry(dto: CreateFinancialEntryDto, createdBy: string = null) {
    await this.assertBankAccount(dto.bankAccountId);
    const entry = this.entryRepository.create({ ...dto, createdBy, updatedBy: createdBy });
    return this.entryRepository.save(entry);
  }

  async createExpense(dto: CreateFinancialExpenseDto, createdBy: string = null) {
    await this.assertBankAccount(dto.bankAccountId);
    const expense = this.expenseRepository.create({ ...dto, createdBy, updatedBy: createdBy });
    return this.expenseRepository.save(expense);
  }

  async updateEntry(id: string, dto: UpdateFinancialEntryDto, updatedBy: string = null) {
    const entry = await this.entryRepository.findOne({ where: { id } });
    if (!entry) throw new NotFoundException('Entrada financeira não encontrada.');
    await this.assertBankAccount(dto.bankAccountId);
    await this.entryRepository.update(id, { ...dto, updatedBy });
    return this.entryRepository.findOne({ where: { id } });
  }

  async updateExpense(id: string, dto: UpdateFinancialExpenseDto, updatedBy: string = null) {
    const expense = await this.expenseRepository.findOne({ where: { id } });
    if (!expense) throw new NotFoundException('Saída financeira não encontrada.');
    await this.assertBankAccount(dto.bankAccountId);
    await this.expenseRepository.update(id, { ...dto, updatedBy });
    return this.expenseRepository.findOne({ where: { id } });
  }

  async findAllEntries(pagination: PaginationDto, filters: FinancialEntryFilters = {}) {
    const where: any = {};
    if (filters.campaignId) where.campaignId = filters.campaignId;
    if (filters.startDate && filters.endDate) {
      where.transactionDate = Between(new Date(filters.startDate), new Date(filters.endDate));
    }
    return paginate(this.entryRepository, pagination, where);
  }

  async findAllExpenses(pagination: PaginationDto) {
    return paginate(this.expenseRepository, pagination);
  }

  async getBalance() {
    const entries = await this.entryRepository.find();
    const expenses = await this.expenseRepository.find();
    // Soma em centavos inteiros: evita ruído de ponto flutuante (ex.: -729.4399999999996)
    const cents = (items: { amount: unknown }[]) => items.reduce((sum, e) => sum + Math.round(Number(e.amount) * 100), 0);
    const totalEntries = cents(entries);
    const totalExpenses = cents(expenses);
    return {
      totalEntries: totalEntries / 100,
      totalExpenses: totalExpenses / 100,
      balance: (totalEntries - totalExpenses) / 100,
    };
  }
}
