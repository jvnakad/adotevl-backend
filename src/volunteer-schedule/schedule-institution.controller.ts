import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AccessGuard } from '../access/access.guard';
import { AdminOnly, RequireAccess } from '../access/access.decorator';
import { AccessLevel, Screen } from '../access/access';
import { ScheduleInstitutionService } from './schedule-institution.service';
import { CreateScheduleInstitutionDto, UpdateScheduleInstitutionDto } from './dto/schedule.dto';

/** Configuração da Agenda (Screen.SCHEDULE_SETTINGS): só a equipe Admin mantém as faculdades. */
@ApiTags('Agenda: faculdades')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Controller('schedule/institutions')
export class ScheduleInstitutionController {
  constructor(private readonly institutions: ScheduleInstitutionService) {}

  @Get('active')
  @RequireAccess(Screen.SCHEDULE, AccessLevel.VIEW)
  @ApiOperation({ summary: 'Faculdades ativas (select do agendamento)', description: 'Acesso: Agenda (Visualizar). Só as ativas, em ordem alfabética: `[{ id, name }]`. Declarada antes das rotas com `:id`.' })
  findActive(@Req() req) {
    return this.institutions.findActive(req.user.organizationId);
  }

  @Get()
  @AdminOnly()
  @ApiOperation({ summary: 'Listar faculdades', description: 'Somente equipe Admin (Configuração da Agenda). Ativas e inativas, com `totalShifts` e `upcomingShifts` (turnos futuros não cancelados).' })
  findAll(@Req() req) {
    return this.institutions.findAll(req.user.organizationId);
  }

  @Post()
  @AdminOnly()
  @ApiOperation({ summary: 'Criar faculdade', description: 'Somente equipe Admin. Nome até 80 caracteres, único na organização (409 se repetido).' })
  create(@Body() dto: CreateScheduleInstitutionDto, @Req() req) {
    return this.institutions.create(dto, req.user.id, req.user.organizationId);
  }

  @Patch(':id')
  @AdminOnly()
  @ApiOperation({ summary: 'Renomear, ativar ou desativar (parcial)', description: 'Somente equipe Admin. Não altera agendamentos existentes. A resposta traz `upcomingShifts` (aviso informativo ao desativar).' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateScheduleInstitutionDto, @Req() req) {
    return this.institutions.update(id, dto, req.user.id, req.user.organizationId);
  }

  @Delete(':id')
  @AdminOnly()
  @ApiOperation({ summary: 'Excluir faculdade', description: 'Somente equipe Admin. Só se nunca usada em agendamento; senão 409 e é preciso desativar.' })
  remove(@Param('id', ParseUUIDPipe) id: string, @Req() req) {
    return this.institutions.remove(id, req.user.organizationId);
  }
}
