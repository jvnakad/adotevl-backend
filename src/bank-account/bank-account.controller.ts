import { Controller, Post, Get, Put, Delete, Param, Body, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AccessGuard } from '../access/access.guard';
import { AdminOnly, RequireAccess } from '../access/access.decorator';
import { AccessLevel, Screen } from '../access/access';
import { BankAccountService } from './bank-account.service';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { PaginationDto } from '../common/pagination.dto';

@ApiTags('Contas Bancárias')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Controller('bank-accounts')
export class BankAccountController {
  constructor(private readonly bankAccountService: BankAccountService) {}

  @Post()
  @RequireAccess(Screen.BANK_ACCOUNTS, AccessLevel.EDIT)
  @ApiOperation({ summary: 'Cadastrar conta bancária', description: 'Acesso: Contas bancárias (Editar)' })
  create(@Body() dto: CreateBankAccountDto, @Request() req) {
    return this.bankAccountService.create({ ...dto, organizationId: req.user.organizationId });
  }

  @Get()
  @RequireAccess(Screen.BANK_ACCOUNTS, AccessLevel.VIEW)
  @ApiOperation({ summary: 'Listar contas bancárias', description: 'Acesso: Contas bancárias (Visualizar)' })
  findAll(@Query() pagination: PaginationDto, @Request() req) {
    // A organização vem do token; o parâmetro da URL é ignorado
    return this.bankAccountService.findAll(pagination, req.user.organizationId);
  }

  @Get(':id')
  @RequireAccess(Screen.BANK_ACCOUNTS, AccessLevel.VIEW)
  @ApiOperation({ summary: 'Buscar conta bancária por ID', description: 'Acesso: Contas bancárias (Visualizar)' })
  findOne(@Param('id') id: string) {
    return this.bankAccountService.findOne(id);
  }

  @Put(':id')
  @RequireAccess(Screen.BANK_ACCOUNTS, AccessLevel.EDIT)
  @ApiOperation({ summary: 'Atualizar conta bancária', description: 'Acesso: Contas bancárias (Editar)' })
  update(@Param('id') id: string, @Body() dto: Partial<CreateBankAccountDto>) {
    return this.bankAccountService.update(id, dto);
  }

  @Delete(':id')
  @RequireAccess(Screen.BANK_ACCOUNTS, AccessLevel.EDIT)
  @ApiOperation({ summary: 'Desativar conta bancária', description: 'Acesso: Contas bancárias (Editar)' })
  remove(@Param('id') id: string) {
    return this.bankAccountService.remove(id);
  }
}
