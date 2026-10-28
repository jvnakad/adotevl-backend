import { Controller, Post, Get, Put, Param, Body, Query, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AccessGuard } from '../access/access.guard';
import { AdminOnly, RequireAccess } from '../access/access.decorator';
import { AccessLevel, Screen } from '../access/access';
import { CampaignService } from './campaign.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { PaginationDto } from '../common/pagination.dto';

@ApiTags('Campanhas')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Controller('campaigns')
export class CampaignController {
  constructor(private readonly campaignService: CampaignService) {}

  @Post()
  @RequireAccess(Screen.CAMPAIGNS, AccessLevel.EDIT)
  @ApiOperation({ summary: 'Criar campanha', description: 'Acesso: Campanhas (Editar)' })
  create(@Body() dto: CreateCampaignDto, @Request() req) {
    return this.campaignService.create({ ...dto, organizationId: req.user.organizationId }, req.user.id);
  }

  @Get()
  @RequireAccess(Screen.CAMPAIGNS, AccessLevel.VIEW)
  @ApiOperation({ summary: 'Listar campanhas', description: 'Acesso: Campanhas (Visualizar)' })
  findAll(@Query() pagination: PaginationDto, @Request() req) {
    // A organização vem do token; o parâmetro da URL é ignorado
    return this.campaignService.findAll(pagination, req.user.organizationId);
  }

  @Get(':id')
  @RequireAccess(Screen.CAMPAIGNS, AccessLevel.VIEW)
  @ApiOperation({ summary: 'Buscar campanha por ID', description: 'Acesso: Campanhas (Visualizar)' })
  findOne(@Param('id') id: string) {
    return this.campaignService.findOne(id);
  }

  @Put(':id')
  @RequireAccess(Screen.CAMPAIGNS, AccessLevel.EDIT)
  @ApiOperation({ summary: 'Atualizar campanha', description: 'Acesso: Campanhas (Editar)' })
  update(@Param('id') id: string, @Body() dto: Partial<CreateCampaignDto>, @Request() req) {
    return this.campaignService.update(id, dto, req.user.id);
  }
}
