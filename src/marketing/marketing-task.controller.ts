import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AccessGuard } from '../access/access.guard';
import { RequireAccess } from '../access/access.decorator';
import { AccessLevel, Screen } from '../access/access';
import { MarketingTaskService } from './marketing-task.service';
import { CreateMarketingTaskDto, UpdateMarketingTaskDto } from './dto/marketing-task.dto';
import { MoveByIndexDto } from './dto/marketing-list.dto';

@ApiTags('Marketing: subtarefas')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Controller('marketing/cards/:cardId/tasks')
export class MarketingTaskController {
  constructor(private readonly taskService: MarketingTaskService) {}

  @Get()
  @RequireAccess(Screen.MARKETING, AccessLevel.VIEW)
  @ApiOperation({ summary: 'Listar subtarefas do card', description: 'Acesso: Marketing (Visualizar). Na ordem do checklist.' })
  findAll(@Param('cardId', ParseUUIDPipe) cardId: string, @Request() req) {
    return this.taskService.findAll(cardId, req.user.organizationId);
  }

  @Post()
  @RequireAccess(Screen.MARKETING, AccessLevel.EDIT)
  @ApiOperation({ summary: 'Criar subtarefa', description: 'Acesso: Marketing (Editar). Entra no fim do checklist.' })
  create(@Param('cardId', ParseUUIDPipe) cardId: string, @Body() dto: CreateMarketingTaskDto, @Request() req) {
    return this.taskService.create(cardId, dto, req.user.id, req.user.organizationId);
  }

  @Patch(':taskId')
  @RequireAccess(Screen.MARKETING, AccessLevel.EDIT)
  @ApiOperation({ summary: 'Editar subtarefa (parcial)', description: 'Acesso: Marketing (Editar). Texto, concluída, responsável e prazo. Concluir registra SUBTAREFA_CONCLUIDA.' })
  update(@Param('cardId', ParseUUIDPipe) cardId: string, @Param('taskId', ParseUUIDPipe) taskId: string, @Body() dto: UpdateMarketingTaskDto, @Request() req) {
    return this.taskService.update(cardId, taskId, dto, req.user.id, req.user.organizationId);
  }

  @Patch(':taskId/move')
  @RequireAccess(Screen.MARKETING, AccessLevel.EDIT)
  @ApiOperation({ summary: 'Reordenar subtarefa', description: 'Acesso: Marketing (Editar). Índice de destino (base 0) entre as subtarefas ativas.' })
  move(@Param('cardId', ParseUUIDPipe) cardId: string, @Param('taskId', ParseUUIDPipe) taskId: string, @Body() dto: MoveByIndexDto, @Request() req) {
    return this.taskService.move(cardId, taskId, dto, req.user.id, req.user.organizationId);
  }

  @Delete(':taskId')
  @RequireAccess(Screen.MARKETING, AccessLevel.EDIT)
  @ApiOperation({ summary: 'Excluir subtarefa (lógico)', description: 'Acesso: Marketing (Editar).' })
  remove(@Param('cardId', ParseUUIDPipe) cardId: string, @Param('taskId', ParseUUIDPipe) taskId: string, @Request() req) {
    return this.taskService.remove(cardId, taskId, req.user.id, req.user.organizationId);
  }
}
