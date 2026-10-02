import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AdoptionHistoryService } from './adoption-history.service';
import { FindAdoptionHistoryDto } from './dto/find-adoption-history.dto';

@ApiTags('Histórico de adoção')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('adoption-history')
export class AdoptionHistoryController {
  constructor(private readonly historyService: AdoptionHistoryService) {}

  @Get()
  @Roles('ADMIN', 'VOLUNTEER')
  @ApiOperation({
    summary: 'Listar histórico das fichas de adoção',
    description: 'Perfis permitidos: ADMIN, VOLUNTEER. Eventos da organização do usuário, mais recentes primeiro. Filtros: type, adoptionFormId, search (nome do adotante), from/to (YYYY-MM-DD, inclusivos).',
  })
  findAll(@Query() query: FindAdoptionHistoryDto, @Request() req) {
    return this.historyService.findAll(query, req.user.organizationId);
  }
}
