import { Controller, Post, Get, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { OrganizationService } from './organization.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { PaginationDto } from '../common/pagination.dto';

@ApiTags('Organizações')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('organizations')
export class OrganizationController {
  constructor(private readonly organizationService: OrganizationService) {}

  @Post()
  @ApiOperation({ summary: 'Criar organização', description: 'Perfis permitidos: ADMIN' })
  create(@Body() dto: CreateOrganizationDto) {
    return this.organizationService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar organizações', description: 'Perfis permitidos: ADMIN' })
  findAll(@Query() pagination: PaginationDto) {
    return this.organizationService.findAll(pagination);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar organização por ID', description: 'Perfis permitidos: ADMIN' })
  findOne(@Param('id') id: string) {
    return this.organizationService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar organização', description: 'Perfis permitidos: ADMIN' })
  update(@Param('id') id: string, @Body() dto: any) {
    return this.organizationService.update(id, dto);
  }
}
