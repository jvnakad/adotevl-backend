import { Controller, Post, Get, Put, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PartnerService } from './partner.service';
import { CreatePartnerDto } from './dto/create-partner.dto';

@ApiTags('Parceiros')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('partners')
export class PartnerController {
  constructor(private readonly partnerService: PartnerService) {}

  @Post()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Cadastrar parceiro', description: 'Perfis permitidos: ADMIN' })
  create(@Body() dto: CreatePartnerDto) {
    return this.partnerService.create(dto);
  }

  @Get()
  @Roles('ADMIN', 'FINANCIAL')
  @ApiOperation({ summary: 'Listar parceiros', description: 'Perfis permitidos: ADMIN, FINANCIAL' })
  findAll() {
    return this.partnerService.findAll();
  }

  @Get(':id')
  @Roles('ADMIN', 'FINANCIAL')
  @ApiOperation({ summary: 'Buscar parceiro por ID', description: 'Perfis permitidos: ADMIN, FINANCIAL' })
  findOne(@Param('id') id: string) {
    return this.partnerService.findOne(id);
  }

  @Put(':id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Atualizar parceiro', description: 'Perfis permitidos: ADMIN' })
  update(@Param('id') id: string, @Body() dto: Partial<CreatePartnerDto>) {
    return this.partnerService.update(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Desativar parceiro', description: 'Perfis permitidos: ADMIN' })
  remove(@Param('id') id: string) {
    return this.partnerService.remove(id);
  }
}
