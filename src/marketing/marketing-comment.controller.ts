import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AccessGuard } from '../access/access.guard';
import { RequireAccess } from '../access/access.decorator';
import { AccessLevel, Screen } from '../access/access';
import { PaginationDto } from '../common/pagination.dto';
import { MarketingCommentService } from './marketing-comment.service';
import { CreateMarketingCommentDto, UpdateMarketingCommentDto } from './dto/marketing-comment.dto';

@ApiTags('Marketing: comentários')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Controller('marketing/cards/:cardId/comments')
export class MarketingCommentController {
  constructor(private readonly commentService: MarketingCommentService) {}

  @Get()
  @RequireAccess(Screen.MARKETING, AccessLevel.VIEW)
  @ApiOperation({ summary: 'Listar comentários do card', description: 'Acesso: Marketing (Visualizar). Mais recentes primeiro, paginado.' })
  findAll(@Param('cardId', ParseUUIDPipe) cardId: string, @Query() query: PaginationDto, @Request() req) {
    return this.commentService.findAll(cardId, query, req.user.organizationId);
  }

  @Post()
  @RequireAccess(Screen.MARKETING, AccessLevel.EDIT)
  @ApiOperation({ summary: 'Comentar', description: 'Acesso: Marketing (Editar). mentionUserIds: só valem usuários com Editar em Marketing cujo @Nome está no texto.' })
  create(@Param('cardId', ParseUUIDPipe) cardId: string, @Body() dto: CreateMarketingCommentDto, @Request() req) {
    return this.commentService.create(cardId, dto, req.user.id, req.user.organizationId);
  }

  @Patch(':commentId')
  @RequireAccess(Screen.MARKETING, AccessLevel.EDIT)
  @ApiOperation({ summary: 'Editar comentário', description: 'Acesso: Marketing (Editar), só o autor. Marca editedAt; não gera evento no histórico.' })
  update(@Param('cardId', ParseUUIDPipe) cardId: string, @Param('commentId', ParseUUIDPipe) commentId: string, @Body() dto: UpdateMarketingCommentDto, @Request() req) {
    return this.commentService.update(cardId, commentId, dto, req.user.id, req.user.organizationId);
  }

  @Delete(':commentId')
  @RequireAccess(Screen.MARKETING, AccessLevel.EDIT)
  @ApiOperation({ summary: 'Excluir comentário (lógico)', description: 'Acesso: Marketing (Editar), o autor; a equipe Admin exclui qualquer um.' })
  remove(@Param('cardId', ParseUUIDPipe) cardId: string, @Param('commentId', ParseUUIDPipe) commentId: string, @Request() req) {
    return this.commentService.remove(cardId, commentId, req.user.id, req.user.organizationId, req.access.isAdmin);
  }
}
