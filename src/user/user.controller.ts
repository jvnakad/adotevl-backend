import { Controller, Post, Get, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
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
  findAll(@Query() pagination: PaginationDto) {
    return this.userService.findAll(pagination);
  }

  @Get(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'FINANCIAL', 'VOLUNTEER')
  @ApiOperation({ summary: 'Buscar usuário por ID', description: 'Perfis permitidos: ADMIN, FINANCIAL, VOLUNTEER' })
  findOne(@Param('id') id: string) {
    return this.userService.findOne(id);
  }

  @Patch('confirm/:code')
  @ApiOperation({ summary: 'Confirmar conta', description: 'Pública — ativada via link enviado por e-mail.' })
  confirmAccount(@Param('code') code: string) {
    return this.userService.confirmAccount(code);
  }
}
