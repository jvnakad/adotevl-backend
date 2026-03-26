import { Controller, Post, Get, Put, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CampaignService } from './campaign.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';

@ApiTags('Campanhas')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('campaigns')
export class CampaignController {
  constructor(private readonly campaignService: CampaignService) {}

  @Post()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Criar campanha', description: 'Perfis permitidos: ADMIN' })
  create(@Body() dto: CreateCampaignDto) {
    return this.campaignService.create(dto);
  }

  @Get()
  @Roles('ADMIN', 'FINANCIAL', 'VOLUNTEER')
  @ApiOperation({ summary: 'Listar campanhas', description: 'Perfis permitidos: ADMIN, FINANCIAL, VOLUNTEER' })
  findAll(@Query('organizationId') organizationId?: string) {
    return this.campaignService.findAll(organizationId);
  }

  @Get(':id')
  @Roles('ADMIN', 'FINANCIAL', 'VOLUNTEER')
  @ApiOperation({ summary: 'Buscar campanha por ID', description: 'Perfis permitidos: ADMIN, FINANCIAL, VOLUNTEER' })
  findOne(@Param('id') id: string) {
    return this.campaignService.findOne(id);
  }

  @Put(':id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Atualizar campanha', description: 'Perfis permitidos: ADMIN' })
  update(@Param('id') id: string, @Body() dto: Partial<CreateCampaignDto>) {
    return this.campaignService.update(id, dto);
  }
}
