import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AccessGuard } from '../access/access.guard';
import { AdminOnly, RequireAccess } from '../access/access.decorator';
import { AccessLevel, Screen } from '../access/access';
import { PaginationDto } from '../common/pagination.dto';
import { MarketingCardService } from './marketing-card.service';
import { MarketingHistoryService } from './marketing-history.service';
import { requireCard } from './marketing-card.helper';
import { CreateMarketingCardDto, FindArchivedCardsDto, MoveMarketingCardDto, SetCoverDto, UpdateMarketingCardDto } from './dto/marketing-card.dto';
import { FindMarketingBoardDto, FindMarketingCalendarDto, FindMarketingCardsDto } from './dto/marketing-query.dto';

@ApiTags('Marketing: quadro e cards')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Controller('marketing')
export class MarketingCardController {
  constructor(
    private readonly cardService: MarketingCardService,
    private readonly historyService: MarketingHistoryService,
    private readonly dataSource: DataSource,
  ) {}

  @Get('board')
  @RequireAccess(Screen.MARKETING, AccessLevel.VIEW)
  @ApiOperation({ summary: 'Quadro', description: 'Acesso: Marketing (Visualizar). Filas ativas na ordem, cada uma com a primeira página dos cards (limit, padrão 20), total e hasMore. Filtros: q, memberIds, labelIds, listIds, createdFrom/To, dueFrom/To, publishFrom/To.' })
  board(@Query() query: FindMarketingBoardDto, @Request() req) {
    return this.cardService.board(query, req.user.organizationId);
  }

  @Get('members')
  @RequireAccess(Screen.MARKETING, AccessLevel.VIEW)
  @ApiOperation({ summary: 'Usuários elegíveis (membros, responsáveis, menções)', description: 'Acesso: Marketing (Visualizar). Usuários com Editar em Marketing (equipe Marketing e Admin), A→Z.' })
  members(@Request() req) {
    return this.cardService.findMembers(req.user.organizationId);
  }

  @Get('calendar')
  @RequireAccess(Screen.MARKETING, AccessLevel.VIEW)
  @ApiOperation({
    summary: 'Calendário',
    description: 'Acesso: Marketing (Visualizar). Cards ativos com a data escolhida (dateField=due|publish) dentro de from..to, e withoutDateCount (cards ativos sem essa data). Arrastar no calendário usa PATCH /marketing/cards/:id.',
  })
  calendar(@Query() query: FindMarketingCalendarDto, @Request() req) {
    return this.cardService.calendar(query, req.user.organizationId);
  }

  @Get('cards')
  @RequireAccess(Screen.MARKETING, AccessLevel.VIEW)
  @ApiOperation({
    summary: 'Visão Lista dos cards',
    description: 'Acesso: Marketing (Visualizar). Cards ativos paginados (limit até 100). sort: due (padrão), title, list, createdAt; order: asc|desc; without=due|publish só cards sem essa data.',
  })
  findAll(@Query() query: FindMarketingCardsDto, @Request() req) {
    return this.cardService.findAll(query, req.user.organizationId);
  }

  @Get('cards/archived')
  @RequireAccess(Screen.MARKETING, AccessLevel.VIEW)
  @ApiOperation({ summary: 'Listar cards arquivados', description: 'Acesso: Marketing (Visualizar). Paginado, arquivados mais recentes primeiro. Filtro: search (título).' })
  archived(@Query() query: FindArchivedCardsDto, @Request() req) {
    return this.cardService.findArchived(query, req.user.organizationId);
  }

  @Post('cards')
  @RequireAccess(Screen.MARKETING, AccessLevel.EDIT)
  @ApiOperation({ summary: 'Criar card', description: 'Acesso: Marketing (Editar). Entra no fim da fila informada.' })
  create(@Body() dto: CreateMarketingCardDto, @Request() req) {
    return this.cardService.create(dto, req.user.id, req.user.organizationId);
  }

  @Get('cards/:id')
  @RequireAccess(Screen.MARKETING, AccessLevel.VIEW)
  @ApiOperation({ summary: 'Detalhe do card', description: 'Acesso: Marketing (Visualizar). Inclui arquivados. Traz membros, etiquetas, subtarefas e anexos (URLs assinadas de 1 hora).' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.cardService.findOne(id, req.user.organizationId);
  }

  @Patch('cards/:id')
  @RequireAccess(Screen.MARKETING, AccessLevel.EDIT)
  @ApiOperation({
    summary: 'Editar card (parcial)',
    description:
      'Acesso: Marketing (Editar). Título, descrição, datas (dueDate, publishDate), fila (vai para o fim), memberIds e labelIds (conjunto completo). Sem mudança real não grava nem gera evento. Card arquivado é recusado.',
  })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMarketingCardDto, @Request() req) {
    return this.cardService.update(id, dto, req.user.id, req.user.organizationId);
  }

  @Patch('cards/:id/move')
  @RequireAccess(Screen.MARKETING, AccessLevel.EDIT)
  @ApiOperation({ summary: 'Mover card', description: 'Acesso: Marketing (Editar). Fila + vizinhos visíveis (afterCardId/beforeCardId; nenhum = fim da fila); o servidor calcula a position. Evento CARD_MOVIDO só quando a fila muda.' })
  move(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MoveMarketingCardDto, @Request() req) {
    return this.cardService.move(id, dto, req.user.id, req.user.organizationId);
  }

  @Post('cards/:id/archive')
  @RequireAccess(Screen.MARKETING, AccessLevel.EDIT)
  @ApiOperation({ summary: 'Arquivar card', description: 'Acesso: Marketing (Editar). Soft delete; o card sai do quadro.' })
  archive(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.cardService.archive(id, req.user.id, req.user.organizationId);
  }

  @Post('cards/:id/restore')
  @AdminOnly()
  @ApiOperation({ summary: 'Restaurar card arquivado', description: 'Somente equipe Admin. Volta ao fim da fila de origem; se ela foi excluída, ao fim da primeira fila ativa.' })
  restore(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.cardService.restore(id, req.user.id, req.user.organizationId);
  }

  @Patch('cards/:id/cover')
  @RequireAccess(Screen.MARKETING, AccessLevel.EDIT)
  @ApiOperation({ summary: 'Definir ou remover a capa', description: 'Acesso: Marketing (Editar). Manual: attachmentId de uma imagem ativa do card, ou null para remover. Não há capa automática.' })
  setCover(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetCoverDto, @Request() req) {
    return this.cardService.setCover(id, dto.attachmentId, req.user.organizationId);
  }

  @Get('cards/:id/history')
  @RequireAccess(Screen.MARKETING, AccessLevel.VIEW)
  @ApiOperation({ summary: 'Histórico do card', description: 'Acesso: Marketing (Visualizar). Eventos do card, mais recentes primeiro, paginado.' })
  async history(@Param('id', ParseUUIDPipe) id: string, @Query() query: PaginationDto, @Request() req) {
    await requireCard(this.dataSource.manager, id, req.user.organizationId);
    return this.historyService.findByCard(id, req.user.organizationId, query);
  }
}
