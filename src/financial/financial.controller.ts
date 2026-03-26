import { Controller, Post, Get, Body } from '@nestjs/common';
import { FinancialService } from './financial.service';
import { CreateFinancialEntryDto } from './dto/create-financial-entry.dto';
import { CreateFinancialExpenseDto } from './dto/create-financial-expense.dto';

@Controller('financial')
export class FinancialController {
  constructor(private readonly financialService: FinancialService) {}

  @Post('entries')
  createEntry(@Body() dto: CreateFinancialEntryDto) {
    return this.financialService.createEntry(dto);
  }

  @Post('expenses')
  createExpense(@Body() dto: CreateFinancialExpenseDto) {
    return this.financialService.createExpense(dto);
  }

  @Get('entries')
  findAllEntries() {
    return this.financialService.findAllEntries();
  }

  @Get('expenses')
  findAllExpenses() {
    return this.financialService.findAllExpenses();
  }

  @Get('balance')
  getBalance() {
    return this.financialService.getBalance();
  }
}
