import { Controller, Post, Get, Put, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PaginationDto } from '../common/pagination.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PetService } from './pet.service';
import { CreatePetDto } from './dto/create-pet.dto';

@ApiTags('Pets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('pets')
export class PetController {
  constructor(private readonly petService: PetService) {}

  @Post()
  @Roles('ADMIN', 'VOLUNTEER')
  @ApiOperation({ summary: 'Cadastrar pet', description: 'Perfis permitidos: ADMIN, VOLUNTEER' })
  create(@Body() dto: CreatePetDto) {
    return this.petService.create(dto);
  }

  @Get()
  @Roles('ADMIN', 'VOLUNTEER')
  @ApiOperation({ summary: 'Listar pets', description: 'Perfis permitidos: ADMIN, VOLUNTEER' })
  findAll(@Query() pagination: PaginationDto, @Query('organizationId') organizationId?: string) {
    return this.petService.findAll(pagination, organizationId);
  }

  @Get(':id')
  @Roles('ADMIN', 'VOLUNTEER')
  @ApiOperation({ summary: 'Buscar pet por ID', description: 'Perfis permitidos: ADMIN, VOLUNTEER' })
  findOne(@Param('id') id: string) {
    return this.petService.findOne(id);
  }

  @Put(':id')
  @Roles('ADMIN', 'VOLUNTEER')
  @ApiOperation({ summary: 'Atualizar pet', description: 'Perfis permitidos: ADMIN, VOLUNTEER' })
  update(@Param('id') id: string, @Body() dto: Partial<CreatePetDto>) {
    return this.petService.update(id, dto);
  }
}
