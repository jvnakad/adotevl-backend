import { Controller, Post, Get, Put, Param, Body } from '@nestjs/common';
import { VolunteerService } from './volunteer.service';
import { CreateVolunteerDto } from './dto/create-volunteer.dto';

@Controller('volunteers')
export class VolunteerController {
  constructor(private readonly volunteerService: VolunteerService) {}

  @Post()
  create(@Body() dto: CreateVolunteerDto) {
    return this.volunteerService.create(dto);
  }

  @Get()
  findAll() {
    return this.volunteerService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.volunteerService.findOne(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: Partial<CreateVolunteerDto>) {
    return this.volunteerService.update(id, dto);
  }
}
