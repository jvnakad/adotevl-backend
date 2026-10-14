import { Controller, Post, Get, Patch, Param, Body, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AccessGuard } from '../access/access.guard';
import { AdminOnly, RequireAccess } from '../access/access.decorator';
import { AccessLevel, hasLevel, Screen } from '../access/access';
import { AccessService } from '../access/access.service';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ApproveUserDto } from './dto/approve-user.dto';
import { PaginationDto } from '../common/pagination.dto';

@ApiTags('Usuários')
@Controller('users')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly accessService: AccessService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Cadastrar usuário', description: 'Rota pública (cadastro de voluntário). A conta fica aguardando aprovação.' })
  create(@Body() dto: CreateUserDto) {
    return this.userService.create(dto);
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AccessGuard)
  @RequireAccess(Screen.VOLUNTEERS, AccessLevel.VIEW)
  @ApiOperation({ summary: 'Listar usuários', description: 'Acesso: Voluntários (Visualizar). Filtros: isApproved, teamId. Cada usuário vem com a equipe.' })
  findAll(@Query() pagination: PaginationDto, @Query('isApproved') isApproved?: string, @Query('teamId') teamId?: string) {
    const approved = isApproved !== undefined ? isApproved === 'true' : undefined;
    return this.userService.findAll(pagination, { isApproved: approved, teamId: teamId || undefined });
  }

  @Get(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Buscar usuário por ID', description: 'Qualquer usuário logado.' })
  findOne(@Param('id') id: string) {
    return this.userService.findOne(id);
  }

  @Patch(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Atualizar usuário', description: 'Próprio perfil: qualquer usuário. Outros usuários: Voluntários (Editar).' })
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto, @Req() req) {
    const access = await this.accessService.forUser(req.user.id);
    const canManage = !!access && (access.isAdmin || hasLevel(access.permissions[Screen.VOLUNTEERS], AccessLevel.EDIT));
    return this.userService.update(id, dto, req.user.id, canManage);
  }

  @Patch(':id/activate')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AccessGuard)
  @RequireAccess(Screen.VOLUNTEERS, AccessLevel.EDIT)
  @ApiOperation({ summary: 'Ativar usuário', description: 'Acesso: Voluntários (Editar).' })
  activate(@Param('id') id: string, @Req() req) {
    return this.userService.activate(id, req.user.id);
  }

  @Patch(':id/approve')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AccessGuard)
  @AdminOnly()
  @ApiOperation({ summary: 'Aprovar usuário', description: 'Somente equipe Admin. Exige a equipe do voluntário (teamId).' })
  approve(@Param('id') id: string, @Body() dto: ApproveUserDto, @Req() req) {
    return this.userService.approve(id, dto.teamId, req.user.id);
  }

  @Patch(':id/reject')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AccessGuard)
  @AdminOnly()
  @ApiOperation({ summary: 'Rejeitar/desativar usuário', description: 'Somente equipe Admin. Não desativa o último membro da equipe Admin.' })
  reject(@Param('id') id: string, @Req() req) {
    return this.userService.reject(id, req.user.id);
  }

  @Patch(':id/team')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AccessGuard)
  @AdminOnly()
  @ApiOperation({ summary: 'Trocar equipe do usuário', description: 'Somente equipe Admin. A equipe Admin precisa de ao menos um membro ativo.' })
  changeTeam(@Param('id') id: string, @Body() dto: ApproveUserDto, @Req() req) {
    return this.userService.changeTeam(id, dto.teamId, req.user.id);
  }

  @Patch(':id/reset-password')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AccessGuard)
  @RequireAccess(Screen.VOLUNTEERS, AccessLevel.EDIT)
  @ApiOperation({ summary: 'Resetar senha do usuário', description: 'Acesso: Voluntários (Editar).' })
  resetPassword(@Param('id') id: string) {
    return this.userService.resetPassword(id);
  }

  @Patch('me/password')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Alterar própria senha', description: 'Qualquer usuário logado.' })
  changePassword(@Body() dto: ChangePasswordDto, @Req() req) {
    return this.userService.changePassword(req.user.id, dto);
  }

  @Patch('confirm/:code')
  @ApiOperation({ summary: 'Confirmar conta', description: 'Pública — ativada via link enviado por e-mail.' })
  confirmAccount(@Param('code') code: string) {
    return this.userService.confirmAccount(code);
  }
}
