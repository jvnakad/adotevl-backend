import { Controller, Post, Get, Put, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { TeamService } from './team.service';
import { CreateTeamDto } from './dto/create-team.dto';

@ApiTags('Equipes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('teams')
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  @Post()
  @ApiOperation({ summary: 'Criar equipe', description: 'Perfis permitidos: ADMIN' })
  create(@Body() dto: CreateTeamDto) {
    return this.teamService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar equipes', description: 'Perfis permitidos: ADMIN' })
  findAll(@Query('organizationId') organizationId?: string) {
    return this.teamService.findAll(organizationId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar equipe por ID', description: 'Perfis permitidos: ADMIN' })
  findOne(@Param('id') id: string) {
    return this.teamService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Atualizar equipe', description: 'Perfis permitidos: ADMIN' })
  update(@Param('id') id: string, @Body() dto: Partial<CreateTeamDto>) {
    return this.teamService.update(id, dto);
  }
}
