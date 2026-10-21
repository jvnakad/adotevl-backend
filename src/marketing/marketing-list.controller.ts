import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AccessGuard } from '../access/access.guard';
import { AdminOnly, RequireAccess } from '../access/access.decorator';
import { AccessLevel, Screen } from '../access/access';
import { MarketingListService } from './marketing-list.service';
import { MarketingCardService } from './marketing-card.service';
import { FindMarketingListCardsDto } from './dto/marketing-query.dto';
import { CreateMarketingListDto, MoveByIndexDto, UpdateMarketingListDto } from './dto/marketing-list.dto';

@ApiTags('Marketing: filas')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Controller('marketing/lists')
export class MarketingListController {
  constructor(
    private readonly listService: MarketingListService,
    private readonly cardService: MarketingCardService,
  ) {}

  @Get()
  @RequireAccess(Screen.MARKETING, AccessLevel.VIEW)
  @ApiOperation({
    summary: 'Listar filas',
    description: 'Acesso: Marketing (Visualizar). Filas ativas na ordem do quadro, com a quantidade de cards ativos. Cria as 7 filas padrão na primeira leitura de uma organização sem filas.',
  })
  findAll(@Request() req) {
    return this.listService.findAll(req.user.organizationId);
  }

  @Get(':id/cards')
  @RequireAccess(Screen.MARKETING, AccessLevel.VIEW)
  @ApiOperation({
    summary: 'Cards de uma fila (Ver mais)',
    description: 'Acesso: Marketing (Visualizar). Próxima página dos cards ativos da fila (offset, limit, padrão 20, máximo 100), na ordem do quadro, com os mesmos filtros do quadro.',
  })
  cards(@Param('id', ParseUUIDPipe) id: string, @Query() query: FindMarketingListCardsDto, @Request() req) {
    return this.cardService.listCards(id, query, req.user.organizationId);
  }

  @Post()
  @AdminOnly()
  @ApiOperation({ summary: 'Criar fila', description: 'Somente equipe Admin (Configuração). Entra no fim do quadro. Máximo de 15 filas ativas.' })
  create(@Body() dto: CreateMarketingListDto, @Request() req) {
    return this.listService.create(dto, req.user.id, req.user.organizationId);
  }

  @Patch(':id')
  @AdminOnly()
  @ApiOperation({ summary: 'Editar fila (parcial)', description: 'Somente equipe Admin (Configuração). Nome, cor e fila final (no máximo uma ativa: marcar tira a marca da anterior).' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMarketingListDto, @Request() req) {
    return this.listService.update(id, dto, req.user.id, req.user.organizationId);
  }

  @Patch(':id/move')
  @AdminOnly()
  @ApiOperation({ summary: 'Reordenar fila', description: 'Somente equipe Admin (Configuração). Move a fila para o índice de destino (base 0) entre as demais filas ativas.' })
  move(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MoveByIndexDto, @Request() req) {
    return this.listService.move(id, dto.index, req.user.id, req.user.organizationId);
  }

  @Delete(':id')
  @AdminOnly()
  @ApiOperation({ summary: 'Excluir fila (lógico)', description: 'Somente equipe Admin (Configuração). Só fila sem cards ativos; senão 409 com activeCards.' })
  remove(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.listService.remove(id, req.user.id, req.user.organizationId);
  }
}
