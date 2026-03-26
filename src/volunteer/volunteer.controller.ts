import { Controller, Post, Get, Put, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { VolunteerService } from './volunteer.service';
import { CreateVolunteerDto } from './dto/create-volunteer.dto';
import { PaginationDto } from '../common/pagination.dto';

@ApiTags('Voluntários')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('volunteers')
export class VolunteerController {
  constructor(private readonly volunteerService: VolunteerService) {}

  @Post()
  @ApiOperation({ summary: 'Cadastrar voluntário', description: 'Perfis permitidos: ADMIN' })
  create(@Body() dto: CreateVolunteerDto) {
    return this.volunteerService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar voluntários', description: 'Perfis permitidos: ADMIN' })
  findAll(@Query() pagination: PaginationDto) {
    return this.volunteerService.findAll(pagination);
  }

  @Get(':id')
  @Roles('ADMIN', 'VOLUNTEER')
  @ApiOperation({ summary: 'Buscar voluntário por ID', description: 'Perfis permitidos: ADMIN, VOLUNTEER (próprio registro)' })
  findOne(@Param('id') id: string) {
    return this.volunteerService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Atualizar voluntário', description: 'Perfis permitidos: ADMIN' })
  update(@Param('id') id: string, @Body() dto: Partial<CreateVolunteerDto>) {
    return this.volunteerService.update(id, dto);
  }
}
