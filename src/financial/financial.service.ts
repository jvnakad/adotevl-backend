import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FinancialEntry } from './financial-entry.entity';
import { FinancialExpense } from './financial-expense.entity';
import { CreateFinancialEntryDto } from './dto/create-financial-entry.dto';
import { CreateFinancialExpenseDto } from './dto/create-financial-expense.dto';
import { UpdateFinancialEntryDto } from './dto/update-financial-entry.dto';
import { UpdateFinancialExpenseDto } from './dto/update-financial-expense.dto';
import { PaginationDto } from '../common/pagination.dto';
import { paginate } from '../common/paginate.helper';

@Injectable()
export class FinancialService {
  constructor(
    @InjectRepository(FinancialEntry)
    private readonly entryRepository: Repository<FinancialEntry>,
    @InjectRepository(FinancialExpense)
    private readonly expenseRepository: Repository<FinancialExpense>,
  ) {}

  async createEntry(dto: CreateFinancialEntryDto, createdBy: string = null) {
    const entry = this.entryRepository.create({ ...dto, createdBy, updatedBy: createdBy });
    return this.entryRepository.save(entry);
  }

  async createExpense(dto: CreateFinancialExpenseDto, createdBy: string = null) {
    const expense = this.expenseRepository.create({ ...dto, createdBy, updatedBy: createdBy });
    return this.expenseRepository.save(expense);
  }

  async updateEntry(id: string, dto: UpdateFinancialEntryDto, updatedBy: string = null) {
    const entry = await this.entryRepository.findOne({ where: { id } });
    if (!entry) throw new NotFoundException('Entrada financeira não encontrada.');
    await this.entryRepository.update(id, { ...dto, updatedBy });
    return this.entryRepository.findOne({ where: { id } });
  }

  async updateExpense(id: string, dto: UpdateFinancialExpenseDto, updatedBy: string = null) {
    const expense = await this.expenseRepository.findOne({ where: { id } });
    if (!expense) throw new NotFoundException('Saída financeira não encontrada.');
    await this.expenseRepository.update(id, { ...dto, updatedBy });
    return this.expenseRepository.findOne({ where: { id } });
  }

  async findAllEntries(pagination: PaginationDto) {
    return paginate(this.entryRepository, pagination);
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
