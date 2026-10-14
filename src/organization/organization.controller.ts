import { Controller, Post, Get, Patch, Param, Body, Query, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AccessGuard } from '../access/access.guard';
import { AdminOnly, RequireAccess } from '../access/access.decorator';
import { AccessLevel, Screen } from '../access/access';
import { OrganizationService } from './organization.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { PaginationDto } from '../common/pagination.dto';

@ApiTags('Organizações')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Controller('organizations')
export class OrganizationController {
  constructor(private readonly organizationService: OrganizationService) {}

  @Post()
  @AdminOnly()
  @ApiOperation({ summary: 'Criar organização', description: 'Somente equipe Admin' })
  create(@Body() dto: CreateOrganizationDto, @Request() req) {
    return this.organizationService.create(dto, req.user.id);
  }

  @Get()
  @AdminOnly()
  @ApiOperation({ summary: 'Listar organizações', description: 'Somente equipe Admin' })
  findAll(@Query() pagination: PaginationDto) {
    return this.organizationService.findAll(pagination);
  }

  @Get(':id')
  @AdminOnly()
  @ApiOperation({ summary: 'Buscar organização por ID', description: 'Somente equipe Admin' })
  findOne(@Param('id') id: string) {
    return this.organizationService.findOne(id);
  }

  @Patch(':id')
  @AdminOnly()
  @ApiOperation({ summary: 'Atualizar organização', description: 'Somente equipe Admin' })
  update(@Param('id') id: string, @Body() dto: any) {
    return this.organizationService.update(id, dto);
  }
}
