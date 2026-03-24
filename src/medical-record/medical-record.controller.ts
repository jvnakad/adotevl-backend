import { Controller, Post, Get, Param, Body } from '@nestjs/common';
import { MedicalRecordService } from './medical-record.service';
import { CreateMedicalRecordDto } from './dto/create-medical-record.dto';

@Controller('medical-records')
export class MedicalRecordController {
  constructor(private readonly medicalRecordService: MedicalRecordService) {}

  @Post()
  create(@Body() dto: CreateMedicalRecordDto) {
    return this.medicalRecordService.create(dto);
  }

  @Get('pet/:petId')
  findByPet(@Param('petId') petId: string) {
    return this.medicalRecordService.findByPet(petId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.medicalRecordService.findOne(id);
  }
}
