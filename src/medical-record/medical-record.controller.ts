import { Controller, Post, Get, Patch, Param, Body, Query, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AccessGuard } from '../access/access.guard';
import { AdminOnly, RequireAccess } from '../access/access.decorator';
import { AccessLevel, Screen } from '../access/access';
import { MedicalRecordService } from './medical-record.service';
import { CreateMedicalRecordDto } from './dto/create-medical-record.dto';
import { UpdateMedicalRecordDto } from './dto/update-medical-record.dto';
import { PaginationDto } from '../common/pagination.dto';

@ApiTags('Histórico Médico')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Controller('medical-records')
export class MedicalRecordController {
  constructor(private readonly medicalRecordService: MedicalRecordService) {}

  @Post()
  @RequireAccess(Screen.MEDICAL_RECORDS, AccessLevel.EDIT)
  @ApiOperation({ summary: 'Registrar consulta médica', description: 'Acesso: Prontuário (Editar)' })
  create(@Body() dto: CreateMedicalRecordDto, @Request() req) {
    return this.medicalRecordService.create(dto, req.user.id);
  }

  @Get('pet/:petId')
  @RequireAccess(Screen.MEDICAL_RECORDS, AccessLevel.VIEW)
  @ApiOperation({ summary: 'Listar histórico médico por pet', description: 'Acesso: Prontuário (Visualizar)' })
  findByPet(@Param('petId') petId: string, @Query() pagination: PaginationDto) {
    return this.medicalRecordService.findByPet(petId, pagination);
  }

  @Get(':id')
  @RequireAccess(Screen.MEDICAL_RECORDS, AccessLevel.VIEW)
  @ApiOperation({ summary: 'Buscar registro médico por ID', description: 'Acesso: Prontuário (Visualizar)' })
  findOne(@Param('id') id: string) {
    return this.medicalRecordService.findOne(id);
  }

  @Patch(':id')
  @RequireAccess(Screen.MEDICAL_RECORDS, AccessLevel.EDIT)
  @ApiOperation({ summary: 'Editar registro médico', description: 'Acesso: Prontuário (Editar)' })
  update(@Param('id') id: string, @Body() dto: UpdateMedicalRecordDto, @Request() req) {
    return this.medicalRecordService.update(id, dto, req.user.id);
  }
}
