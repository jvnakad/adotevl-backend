import { Controller, Post, Get, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { FinancialService } from './financial.service';
import { CreateFinancialEntryDto } from './dto/create-financial-entry.dto';
import { CreateFinancialExpenseDto } from './dto/create-financial-expense.dto';
import { PaginationDto } from '../common/pagination.dto';

@ApiTags('Financeiro')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'FINANCIAL')
@Controller('financial')
export class FinancialController {
  constructor(private readonly financialService: FinancialService) {}

  @Post('entries')
  @ApiOperation({ summary: 'Registrar entrada financeira', description: 'Perfis permitidos: ADMIN, FINANCIAL' })
  createEntry(@Body() dto: CreateFinancialEntryDto) {
    return this.financialService.createEntry(dto);
  }

  @Post('expenses')
  @ApiOperation({ summary: 'Registrar saída financeira', description: 'Perfis permitidos: ADMIN, FINANCIAL' })
  createExpense(@Body() dto: CreateFinancialExpenseDto) {
    return this.financialService.createExpense(dto);
  }

  @Get('entries')
  @ApiOperation({ summary: 'Listar entradas financeiras', description: 'Perfis permitidos: ADMIN, FINANCIAL. Filtros: startDate, endDate (YYYY-MM-DD), campaignId' })
  findAllEntries(
    @Query() pagination: PaginationDto,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('campaignId') campaignId?: string,
  ) {
    return this.financialService.findAllEntries(pagination, { startDate, endDate, campaignId });
  }

  @Get('expenses')
  @ApiOperation({ summary: 'Listar saídas financeiras', description: 'Perfis permitidos: ADMIN, FINANCIAL' })
  findAllExpenses(@Query() pagination: PaginationDto) {
    return this.financialService.findAllExpenses(pagination);
  }

  @Get('balance')
  @ApiOperation({ summary: 'Consultar saldo', description: 'Perfis permitidos: ADMIN, FINANCIAL' })
  getBalance() {
    return this.financialService.getBalance();
  }
}
