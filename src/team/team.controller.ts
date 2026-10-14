import { Controller, Post, Get, Put, Param, Body, Query, Request, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AccessGuard } from '../access/access.guard';
import { AdminOnly, RequireAccess } from '../access/access.decorator';
import { AccessLevel, Screen } from '../access/access';
import { TeamService } from './team.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { SetTeamPermissionsDto } from './dto/set-team-permissions.dto';
import { PaginationDto } from '../common/pagination.dto';

@ApiTags('Equipes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Controller('teams')
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  @Post()
  @RequireAccess(Screen.TEAMS, AccessLevel.EDIT)
  @ApiOperation({ summary: 'Criar equipe', description: 'Acesso: Equipes (Editar). Começa sem acesso a nenhuma tela.' })
  create(@Body() dto: CreateTeamDto, @Request() req) {
    return this.teamService.create({ ...dto, organizationId: req.user.organizationId }, req.user.id);
  }

  @Get()
  @RequireAccess(Screen.TEAMS, AccessLevel.VIEW)
  @ApiOperation({ summary: 'Listar equipes', description: 'Acesso: Equipes (Visualizar). Equipes da organização do usuário, Admin primeiro.' })
  findAll(@Query() pagination: PaginationDto, @Request() req) {
    return this.teamService.findAll(pagination, req.user.organizationId);
  }

  @Get(':id')
  @RequireAccess(Screen.TEAMS, AccessLevel.VIEW)
  @ApiOperation({ summary: 'Buscar equipe por ID', description: 'Acesso: Equipes (Visualizar). Inclui a matriz de permissões.' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.teamService.findOne(id);
  }

  @Put(':id')
  @RequireAccess(Screen.TEAMS, AccessLevel.EDIT)
  @ApiOperation({ summary: 'Atualizar equipe', description: 'Acesso: Equipes (Editar). A equipe Admin não pode ser alterada.' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateTeamDto, @Request() req) {
    return this.teamService.update(id, { name: dto.name }, req.user.id);
  }

  @Put(':id/permissions')
  @AdminOnly()
  @ApiOperation({ summary: 'Definir permissões da equipe', description: 'Somente equipe Admin. Sub-tela exige ao menos Visualizar na tela mãe.' })
  setPermissions(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetTeamPermissionsDto, @Request() req) {
    return this.teamService.setPermissions(id, dto.permissions, req.user.id);
  }
}
