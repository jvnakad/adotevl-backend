import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { FinancialEntry } from './financial-entry.entity';
import { FinancialExpense } from './financial-expense.entity';
import { CreateFinancialEntryDto } from './dto/create-financial-entry.dto';
import { CreateFinancialExpenseDto } from './dto/create-financial-expense.dto';
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

  async createEntry(dto: CreateFinancialEntryDto) {
    const entry = this.entryRepository.create(dto);
    return this.entryRepository.save(entry);
  }

  async createExpense(dto: CreateFinancialExpenseDto) {
    const expense = this.expenseRepository.create(dto);
    return this.expenseRepository.save(expense);
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
    const totalEntries = entries.reduce((sum, e) => sum + Number(e.amount), 0);
    const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
    return {
      totalEntries,
      totalExpenses,
      balance: totalEntries - totalExpenses,
    };
  }
}
