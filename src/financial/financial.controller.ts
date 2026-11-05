import { Controller, Post, Get, Patch, Param, Body, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AccessGuard } from '../access/access.guard';
import { AdminOnly, RequireAccess } from '../access/access.decorator';
import { AccessLevel, Screen } from '../access/access';
import { FinancialService } from './financial.service';
import { CreateFinancialEntryDto } from './dto/create-financial-entry.dto';
import { CreateFinancialExpenseDto } from './dto/create-financial-expense.dto';
import { UpdateFinancialEntryDto } from './dto/update-financial-entry.dto';
import { UpdateFinancialExpenseDto } from './dto/update-financial-expense.dto';
import { PaginationDto } from '../common/pagination.dto';

@ApiTags('Financeiro')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Controller('financial')
export class FinancialController {
  constructor(private readonly financialService: FinancialService) {}

  @Post('entries')
  @RequireAccess(Screen.FINANCIAL, AccessLevel.EDIT)
  @ApiOperation({ summary: 'Registrar entrada financeira', description: 'Acesso: Financeiro (Editar)' })
  createEntry(@Body() dto: CreateFinancialEntryDto, @Req() req) {
    return this.financialService.createEntry(dto, req.user.id);
  }

  @Post('expenses')
  @RequireAccess(Screen.FINANCIAL, AccessLevel.EDIT)
  @ApiOperation({ summary: 'Registrar saída financeira', description: 'Acesso: Financeiro (Editar)' })
  createExpense(@Body() dto: CreateFinancialExpenseDto, @Req() req) {
    return this.financialService.createExpense(dto, req.user.id);
  }

  @Patch('entries/:id')
  @RequireAccess(Screen.FINANCIAL, AccessLevel.EDIT)
  @ApiOperation({ summary: 'Editar entrada financeira', description: 'Acesso: Financeiro (Editar)' })
  updateEntry(@Param('id') id: string, @Body() dto: UpdateFinancialEntryDto, @Req() req) {
    return this.financialService.updateEntry(id, dto, req.user.id);
  }

  @Patch('expenses/:id')
  @RequireAccess(Screen.FINANCIAL, AccessLevel.EDIT)
  @ApiOperation({ summary: 'Editar saída financeira', description: 'Acesso: Financeiro (Editar)' })
  updateExpense(@Param('id') id: string, @Body() dto: UpdateFinancialExpenseDto, @Req() req) {
    return this.financialService.updateExpense(id, dto, req.user.id);
  }

  @Get('entries')
  @RequireAccess(Screen.FINANCIAL, AccessLevel.VIEW)
  @ApiOperation({ summary: 'Listar entradas financeiras', description: 'Acesso: Financeiro (Visualizar). Filtros: startDate, endDate (YYYY-MM-DD), campaignId' })
  findAllEntries(
    @Query() pagination: PaginationDto,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('campaignId') campaignId?: string,
  ) {
    return this.financialService.findAllEntries(pagination, { startDate, endDate, campaignId });
  }

  @Get('expenses')
  @RequireAccess(Screen.FINANCIAL, AccessLevel.VIEW)
  @ApiOperation({ summary: 'Listar saídas financeiras', description: 'Acesso: Financeiro (Visualizar)' })
  findAllExpenses(@Query() pagination: PaginationDto) {
    return this.financialService.findAllExpenses(pagination);
  }

  @Get('balance')
  @RequireAccess(Screen.FINANCIAL, AccessLevel.VIEW)
  @ApiOperation({ summary: 'Consultar saldo', description: 'Acesso: Financeiro (Visualizar)' })
  getBalance() {
    return this.financialService.getBalance();
  }
}
