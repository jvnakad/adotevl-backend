import { Controller, Post, Get, Put, Param, Body, Query, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AccessGuard } from '../access/access.guard';
import { AdminOnly, RequireAccess } from '../access/access.decorator';
import { AccessLevel, Screen } from '../access/access';
import { VolunteerService } from './volunteer.service';
import { CreateVolunteerDto } from './dto/create-volunteer.dto';
import { PaginationDto } from '../common/pagination.dto';

@ApiTags('Voluntários')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Controller('volunteers')
export class VolunteerController {
  constructor(private readonly volunteerService: VolunteerService) {}

  @Post()
  @RequireAccess(Screen.VOLUNTEERS, AccessLevel.EDIT)
  @ApiOperation({ summary: 'Cadastrar voluntário', description: 'Acesso: Voluntários (Editar)' })
  create(@Body() dto: CreateVolunteerDto, @Request() req) {
    return this.volunteerService.create(dto, req.user.id);
  }

  @Get()
  @RequireAccess(Screen.VOLUNTEERS, AccessLevel.VIEW)
  @ApiOperation({ summary: 'Listar voluntários', description: 'Acesso: Voluntários (Visualizar). Filtros: teamId' })
  findAll(@Query() pagination: PaginationDto, @Query('teamId') teamId?: string) {
    return this.volunteerService.findAll(pagination, { teamId });
  }

  @Get(':id')
  @RequireAccess(Screen.VOLUNTEERS, AccessLevel.VIEW)
  @ApiOperation({ summary: 'Buscar voluntário por ID', description: 'Acesso: Voluntários (Visualizar)(próprio registro)' })
  findOne(@Param('id') id: string) {
    return this.volunteerService.findOne(id);
  }

  @Put(':id')
  @RequireAccess(Screen.VOLUNTEERS, AccessLevel.EDIT)
  @ApiOperation({ summary: 'Atualizar voluntário', description: 'Acesso: Voluntários (Editar)' })
  update(@Param('id') id: string, @Body() dto: Partial<CreateVolunteerDto>, @Request() req) {
    return this.volunteerService.update(id, dto, req.user.id);
  }
}
