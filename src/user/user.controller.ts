import { Controller, Post, Get, Patch, Param, Body, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { PaginationDto } from '../common/pagination.dto';

@ApiTags('Usuários')
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  @ApiOperation({ summary: 'Criar usuário', description: 'Perfis permitidos: ADMIN' })
  create(@Body() dto: CreateUserDto) {
    return this.userService.create(dto);
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Listar usuários', description: 'Perfis permitidos: ADMIN' })
  findAll(@Query() pagination: PaginationDto, @Query('isApproved') isApproved?: string) {
    const approved = isApproved !== undefined ? isApproved === 'true' : undefined;
    return this.userService.findAll(pagination, approved);
  }

  @Get(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'FINANCIAL', 'VOLUNTEER')
  @ApiOperation({ summary: 'Buscar usuário por ID', description: 'Perfis permitidos: ADMIN, FINANCIAL, VOLUNTEER' })
  findOne(@Param('id') id: string) {
    return this.userService.findOne(id);
  }

  @Patch(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'FINANCIAL', 'VOLUNTEER')
  @ApiOperation({ summary: 'Atualizar usuário', description: 'Perfis permitidos: ADMIN (qualquer usuário), FINANCIAL e VOLUNTEER (apenas o próprio perfil)' })
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @Req() req) {
    return this.userService.update(id, dto, req.user.id, req.user.profileName);
  }

  @Patch(':id/activate')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Ativar usuário', description: 'Perfis permitidos: ADMIN' })
  activate(@Param('id') id: string, @Req() req) {
    return this.userService.activate(id, req.user.id);
  }

  @Patch(':id/approve')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Aprovar usuário', description: 'Perfis permitidos: ADMIN' })
  approve(@Param('id') id: string, @Req() req) {
    return this.userService.approve(id, req.user.id);
  }

  @Patch(':id/reject')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Rejeitar usuário', description: 'Perfis permitidos: ADMIN' })
  reject(@Param('id') id: string, @Req() req) {
    return this.userService.reject(id, req.user.id);
  }

  @Patch(':id/reset-password')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Resetar senha do usuário', description: 'Perfis permitidos: ADMIN' })
  resetPassword(@Param('id') id: string) {
    return this.userService.resetPassword(id);
  }

  @Patch('me/password')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'FINANCIAL', 'VOLUNTEER')
  @ApiOperation({ summary: 'Alterar própria senha', description: 'Perfis permitidos: ADMIN, FINANCIAL, VOLUNTEER' })
  changePassword(@Body() dto: ChangePasswordDto, @Req() req) {
    return this.userService.changePassword(req.user.id, dto);
  }

  @Patch('confirm/:code')
  @ApiOperation({ summary: 'Confirmar conta', description: 'Pública — ativada via link enviado por e-mail.' })
  confirmAccount(@Param('code') code: string) {
    return this.userService.confirmAccount(code);
  }
}
