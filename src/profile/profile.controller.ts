import { Controller, Post, Get, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ProfileService } from './profile.service';
import { CreateProfileDto } from './dto/create-profile.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AccessGuard } from '../access/access.guard';
import { AdminOnly } from '../access/access.decorator';

// Perfis são legado (o acesso vem da equipe): só a equipe Admin consulta/altera
@ApiTags('Perfis (legado)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@AdminOnly()
@Controller('profiles')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Post()
  create(@Body() dto: CreateProfileDto) {
    return this.profileService.create(dto);
  }

  @Get()
  findAll() {
    return this.profileService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.profileService.findOne(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.profileService.remove(id);
  }
}
