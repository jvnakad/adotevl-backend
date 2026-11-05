import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AccessGuard } from '../access/access.guard';
import { RequireAccess } from '../access/access.decorator';
import { AccessLevel, Screen } from '../access/access';
import { StockHistoryService } from './stock-history.service';
import { FindStockHistoryDto } from './dto/find-stock-history.dto';

// Somente leitura: não existe rota de escrita para eventos (RN-39)
@ApiTags('Estoque: histórico')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Controller('stock/history')
export class StockHistoryController {
  constructor(private readonly historyService: StockHistoryService) {}

  @Get()
  @RequireAccess(Screen.STOCK_HISTORY, AccessLevel.VIEW)
  @ApiOperation({
    summary: 'Listar histórico do estoque',
    description:
      'Acesso: Histórico do estoque (Visualizar). Eventos da organização, mais recentes primeiro. Filtros: search (nome atual ou antigo do produto/tipo), type, userId, from/to (YYYY-MM-DD, dia local de Brasília, inclusivos).',
  })
  findAll(@Query() query: FindStockHistoryDto, @Request() req) {
    return this.historyService.findAll(query, req.user.organizationId);
  }

  @Get('users')
  @RequireAccess(Screen.STOCK_HISTORY, AccessLevel.VIEW)
  @ApiOperation({ summary: 'Usuários do histórico do estoque (opções do filtro)', description: 'Acesso: Histórico do estoque (Visualizar). Usuários com eventos na organização, pelo nome gravado, em ordem alfabética.' })
  findUsers(@Request() req) {
    return this.historyService.findUsers(req.user.organizationId);
  }
}
