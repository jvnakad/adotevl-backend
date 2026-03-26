import { Controller, Post, Get, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { MedicalRecordService } from './medical-record.service';
import { CreateMedicalRecordDto } from './dto/create-medical-record.dto';

@ApiTags('Histórico Médico')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'VOLUNTEER')
@Controller('medical-records')
export class MedicalRecordController {
  constructor(private readonly medicalRecordService: MedicalRecordService) {}

  @Post()
  @ApiOperation({ summary: 'Registrar consulta médica', description: 'Perfis permitidos: ADMIN, VOLUNTEER' })
  create(@Body() dto: CreateMedicalRecordDto) {
    return this.medicalRecordService.create(dto);
  }

  @Get('pet/:petId')
  @ApiOperation({ summary: 'Listar histórico médico por pet', description: 'Perfis permitidos: ADMIN, VOLUNTEER' })
  findByPet(@Param('petId') petId: string) {
    return this.medicalRecordService.findByPet(petId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar registro médico por ID', description: 'Perfis permitidos: ADMIN, VOLUNTEER' })
  findOne(@Param('id') id: string) {
    return this.medicalRecordService.findOne(id);
  }
}
