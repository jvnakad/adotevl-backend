import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AccessGuard } from '../access/access.guard';
import { AdminOnly, RequireAccess } from '../access/access.decorator';
import { AccessLevel, Screen } from '../access/access';
import { MarketingLabelService } from './marketing-label.service';
import { CreateMarketingLabelDto, UpdateMarketingLabelDto } from './dto/marketing-label.dto';

@ApiTags('Marketing: etiquetas')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Controller('marketing/labels')
export class MarketingLabelController {
  constructor(private readonly labelService: MarketingLabelService) {}

  @Get()
  @RequireAccess(Screen.MARKETING, AccessLevel.VIEW)
  @ApiOperation({ summary: 'Listar etiquetas', description: 'Acesso: Marketing (Visualizar). Etiquetas ativas em ordem alfabética, com a quantidade de cards ativos que usam cada uma.' })
  findAll(@Request() req) {
    return this.labelService.findAll(req.user.organizationId);
  }

  @Post()
  @AdminOnly()
  @ApiOperation({ summary: 'Criar etiqueta', description: 'Somente equipe Admin (Configuração).' })
  create(@Body() dto: CreateMarketingLabelDto, @Request() req) {
    return this.labelService.create(dto, req.user.id, req.user.organizationId);
  }

  @Get(':id/usage')
  @AdminOnly()
  @ApiOperation({ summary: 'Uso da etiqueta', description: 'Somente equipe Admin. Quantos cards ativos usam a etiqueta (aviso antes de excluir).' })
  usage(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.labelService.usage(id, req.user.organizationId);
  }

  @Patch(':id')
  @AdminOnly()
  @ApiOperation({ summary: 'Editar etiqueta (parcial)', description: 'Somente equipe Admin (Configuração). Nome e cor.' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMarketingLabelDto, @Request() req) {
    return this.labelService.update(id, dto, req.user.id, req.user.organizationId);
  }

  @Delete(':id')
  @AdminOnly()
  @ApiOperation({ summary: 'Excluir etiqueta (lógico)', description: 'Somente equipe Admin (Configuração). Remove a etiqueta de todos os cards e devolve removedFromCards.' })
  remove(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.labelService.remove(id, req.user.id, req.user.organizationId);
  }
}
