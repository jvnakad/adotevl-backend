import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AccessGuard } from '../access/access.guard';
import { AdminOnly, RequireAccess } from '../access/access.decorator';
import { AccessLevel, Screen } from '../access/access';
import { AdoptionHistoryService } from './adoption-history.service';
import { FindAdoptionHistoryDto } from './dto/find-adoption-history.dto';

@ApiTags('Histórico de adoção')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Controller('adoption-history')
export class AdoptionHistoryController {
  constructor(private readonly historyService: AdoptionHistoryService) {}

  @Get()
  @RequireAccess(Screen.ADOPTION_HISTORY, AccessLevel.VIEW)
  @ApiOperation({
    summary: 'Listar histórico das fichas de adoção',
    description: 'Acesso: Histórico de adoção (Visualizar). Eventos da organização do usuário, mais recentes primeiro. Filtros: type, adoptionFormId, search (nome do adotante), from/to (YYYY-MM-DD, inclusivos).',
  })
  findAll(@Query() query: FindAdoptionHistoryDto, @Request() req) {
    return this.historyService.findAll(query, req.user.organizationId);
  }
}
