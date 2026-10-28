import { Controller, Post, Get, Patch, Delete, Param, Body, Query, Req, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { PasswordResetThrottlerGuard } from '../auth/password-reset-throttler.guard';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AccessGuard } from '../access/access.guard';
import { AdminOnly, RequireAccess } from '../access/access.decorator';
import { AccessLevel, hasLevel, Screen } from '../access/access';
import { AccessService } from '../access/access.service';
import { UserService, hideSensitiveUserData } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { CreateFloatingVolunteerDto } from './dto/create-floating-volunteer.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateTutorialDto } from './dto/update-tutorial.dto';
import { ApproveUserDto } from './dto/approve-user.dto';
import { PaginationDto } from '../common/pagination.dto';
import { userAgentOf } from '../auth/user-agent';

@ApiTags('Usuários')
@Controller('users')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly accessService: AccessService,
  ) {}

  @Post()
  @UseGuards(PasswordResetThrottlerGuard)
  @ApiOperation({
    summary: 'Cadastrar voluntário fixo',
    description: 'Rota pública. Exige o questionário (exceto 1º usuário da organização). A conta fica aguardando confirmação do e-mail e aprovação.',
  })
  async create(@Body() dto: CreateUserDto) {
    // Honeypot preenchido = robô: finge sucesso sem gravar
    if (dto.website) return { id: null, email: dto.email };
    const user = await this.userService.create(dto);
    return { id: user.id, email: user.email };
  }

  @Post('floating')
  @UseGuards(PasswordResetThrottlerGuard)
  @ApiOperation({
    summary: 'Cadastrar voluntário volante',
    description: 'Rota pública (modal da LP e /signup). Sem senha: a API gera uma aleatória. Já entra aprovado na equipe Voluntário Volante e recebe e-mail de boas-vindas.',
  })
  createFloating(@Body() dto: CreateFloatingVolunteerDto) {
    if (dto.website) return { id: null, fullName: dto.fullName, email: dto.email };
    return this.userService.createFloating(dto);
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AccessGuard)
  @RequireAccess(Screen.VOLUNTEERS, AccessLevel.VIEW)
  @ApiOperation({ summary: 'Listar usuários', description: 'Acesso: Voluntários (Visualizar). Filtros: isApproved, teamId. Cada usuário vem com a equipe.' })
  async findAll(@Query() pagination: PaginationDto, @Req() req, @Query('isApproved') isApproved?: string, @Query('teamId') teamId?: string) {
    const approved = isApproved !== undefined ? isApproved === 'true' : undefined;
    const result = await this.userService.findAll(pagination, req.user.organizationId, { isApproved: approved, teamId: teamId || undefined });
    const access = await this.accessService.forUser(req.user.id);
    if (access?.isAdmin) return result;
    return { ...result, data: result.data.map((user) => (user.id === req.user.id ? user : hideSensitiveUserData(user))) };
  }

  @Get(':id/application')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AccessGuard)
  @RequireAccess(Screen.VOLUNTEERS, AccessLevel.VIEW)
  @ApiOperation({ summary: 'Questionário do voluntário fixo', description: 'Acesso: Voluntários (Visualizar).' })
  findApplication(@Param('id', ParseUUIDPipe) id: string, @Req() req) {
    return this.userService.findApplication(id, req.user.organizationId);
  }

  @Get(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Buscar usuário por ID', description: 'Qualquer usuário logado, só da própria organização (outra organização responde 404).' })
  async findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req) {
    const user = await this.userService.findInOrganization(id, req.user.organizationId);
    // CPF, telefone e nascimento: só o próprio usuário e a equipe Admin
    if (user.id === req.user.id) return user;
    const access = await this.accessService.forUser(req.user.id);
    return access?.isAdmin ? user : hideSensitiveUserData(user);
  }

  @Patch(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Atualizar usuário', description: 'Próprio perfil: qualquer usuário. Outros usuários: Voluntários (Editar). Só da própria organização.' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto, @Req() req) {
    const access = await this.accessService.forUser(req.user.id);
    const canManage = !!access && (access.isAdmin || hasLevel(access.permissions[Screen.VOLUNTEERS], AccessLevel.EDIT));
    return this.userService.update(id, dto, req.user.id, canManage, req.user.organizationId, !!access?.isAdmin);
  }

  @Patch(':id/activate')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AccessGuard)
  @RequireAccess(Screen.VOLUNTEERS, AccessLevel.EDIT)
  @ApiOperation({ summary: 'Ativar usuário', description: 'Acesso: Voluntários (Editar).' })
  activate(@Param('id', ParseUUIDPipe) id: string, @Req() req) {
    return this.userService.activate(id, req.user.id, req.user.organizationId);
  }

  @Patch(':id/approve')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AccessGuard)
  @AdminOnly()
  @ApiOperation({ summary: 'Aprovar usuário', description: 'Somente equipe Admin. Exige a equipe do voluntário (teamId).' })
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveUserDto, @Req() req) {
    return this.userService.approve(id, dto.teamId, req.user.id, req.user.organizationId);
  }

  @Patch(':id/reject')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AccessGuard)
  @AdminOnly()
  @ApiOperation({ summary: 'Rejeitar/desativar usuário', description: 'Somente equipe Admin. Não desativa o último membro da equipe Admin.' })
  reject(@Param('id', ParseUUIDPipe) id: string, @Req() req) {
    return this.userService.reject(id, req.user.id, req.user.organizationId);
  }

  @Patch(':id/team')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AccessGuard)
  @AdminOnly()
  @ApiOperation({ summary: 'Trocar equipe do usuário', description: 'Somente equipe Admin. A equipe Admin precisa de ao menos um membro ativo.' })
  changeTeam(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveUserDto, @Req() req) {
    return this.userService.changeTeam(id, dto.teamId, req.user.id, req.user.organizationId);
  }

  @Patch(':id/reset-password')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AccessGuard)
  @RequireAccess(Screen.VOLUNTEERS, AccessLevel.EDIT)
  @ApiOperation({
    summary: 'Resetar senha do usuário',
    description: 'Acesso: Voluntários (Editar). Só da própria organização (outra responde 404) e nunca de voluntário volante (400). Derruba as sessões do usuário.',
  })
  resetPassword(@Param('id', ParseUUIDPipe) id: string, @Req() req) {
    return this.userService.resetPassword(id, req.user.organizationId);
  }

  @Patch('me/password')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Alterar própria senha',
    description: 'Qualquer usuário logado. Derruba as outras sessões e devolve o par novo (`access_token` e `refresh_token`, família nova) para a sessão atual.',
  })
  changePassword(@Body() dto: ChangePasswordDto, @Req() req) {
    return this.userService.changePassword(req.user.id, dto, userAgentOf(req));
  }

  @Patch('me/tutorial')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Registrar tour visto / ligar ou desligar tours', description: 'Qualquer usuário logado. `{ tour, version }` marca o tour como visto; `{ disabled }` liga/desliga os tours automáticos.' })
  updateTutorial(@Body() dto: UpdateTutorialDto, @Req() req) {
    return this.userService.updateTutorial(req.user.id, dto);
  }

  @Delete('me/tutorial')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Rever todos os tutoriais', description: 'Qualquer usuário logado. Zera os tours vistos e religa os tours automáticos.' })
  resetTutorial(@Req() req) {
    return this.userService.resetTutorial(req.user.id);
  }

  @Patch('confirm/:code')
  @ApiOperation({ summary: 'Confirmar conta', description: 'Pública — ativada via link enviado por e-mail.' })
  confirmAccount(@Param('code') code: string) {
    return this.userService.confirmAccount(code);
  }
}
