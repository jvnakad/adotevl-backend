import { Controller, Post, Get, Put, Delete, Param, Body, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AccessGuard } from '../access/access.guard';
import { AdminOnly, RequireAccess } from '../access/access.decorator';
import { AccessLevel, Screen } from '../access/access';
import { PartnerService } from './partner.service';
import { CreatePartnerDto } from './dto/create-partner.dto';
import { PaginationDto } from '../common/pagination.dto';

@ApiTags('Parceiros')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Controller('partners')
export class PartnerController {
  constructor(private readonly partnerService: PartnerService) {}

  @Post()
  @RequireAccess(Screen.PARTNERS, AccessLevel.EDIT)
  @ApiOperation({ summary: 'Cadastrar parceiro', description: 'Acesso: Parceiros (Editar)' })
  create(@Body() dto: CreatePartnerDto, @Request() req) {
    return this.partnerService.create(dto, req.user.organizationId);
  }

  @Get()
  @RequireAccess(Screen.PARTNERS, AccessLevel.VIEW)
  @ApiOperation({ summary: 'Listar parceiros', description: 'Acesso: Parceiros (Visualizar)' })
  findAll(@Query() pagination: PaginationDto, @Request() req) {
    return this.partnerService.findAll(pagination, req.user.organizationId);
  }

  @Get(':id')
  @RequireAccess(Screen.PARTNERS, AccessLevel.VIEW)
  @ApiOperation({ summary: 'Buscar parceiro por ID', description: 'Acesso: Parceiros (Visualizar)' })
  findOne(@Param('id') id: string, @Request() req) {
    return this.partnerService.findOne(id, req.user.organizationId);
  }

  @Put(':id')
  @RequireAccess(Screen.PARTNERS, AccessLevel.EDIT)
  @ApiOperation({ summary: 'Atualizar parceiro', description: 'Acesso: Parceiros (Editar)' })
  update(@Param('id') id: string, @Body() dto: Partial<CreatePartnerDto>, @Request() req) {
    return this.partnerService.update(id, dto, req.user.organizationId);
  }

  @Delete(':id')
  @RequireAccess(Screen.PARTNERS, AccessLevel.EDIT)
  @ApiOperation({ summary: 'Desativar parceiro', description: 'Acesso: Parceiros (Editar)' })
  remove(@Param('id') id: string, @Request() req) {
    return this.partnerService.remove(id, req.user.organizationId);
  }
}
