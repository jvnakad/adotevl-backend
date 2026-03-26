import { Controller, Post, Get, Put, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { BankAccountService } from './bank-account.service';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { PaginationDto } from '../common/pagination.dto';

@ApiTags('Contas Bancárias')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('bank-accounts')
export class BankAccountController {
  constructor(private readonly bankAccountService: BankAccountService) {}

  @Post()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Cadastrar conta bancária', description: 'Perfis permitidos: ADMIN' })
  create(@Body() dto: CreateBankAccountDto) {
    return this.bankAccountService.create(dto);
  }

  @Get()
  @Roles('ADMIN', 'FINANCIAL')
  @ApiOperation({ summary: 'Listar contas bancárias', description: 'Perfis permitidos: ADMIN, FINANCIAL' })
  findAll(@Query() pagination: PaginationDto, @Query('organizationId') organizationId?: string) {
    return this.bankAccountService.findAll(pagination, organizationId);
  }

  @Get(':id')
  @Roles('ADMIN', 'FINANCIAL')
  @ApiOperation({ summary: 'Buscar conta bancária por ID', description: 'Perfis permitidos: ADMIN, FINANCIAL' })
  findOne(@Param('id') id: string) {
    return this.bankAccountService.findOne(id);
  }

  @Put(':id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Atualizar conta bancária', description: 'Perfis permitidos: ADMIN' })
  update(@Param('id') id: string, @Body() dto: Partial<CreateBankAccountDto>) {
    return this.bankAccountService.update(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Desativar conta bancária', description: 'Perfis permitidos: ADMIN' })
  remove(@Param('id') id: string) {
    return this.bankAccountService.remove(id);
  }
}
