import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AccessGuard } from '../access/access.guard';
import { RequireAccess } from '../access/access.decorator';
import { AccessLevel, hasLevel, Screen } from '../access/access';
import { VolunteerScheduleService } from './volunteer-schedule.service';
import { CreateScheduleLockDto, CreateShiftDto, ShiftTimesDto } from './dto/schedule.dto';

/** Quem gerencia a agenda (Editar em Agenda): marca/remove por qualquer um e ignora as 24h */
const actorOf = (req) => ({ id: req.user.id, canManage: !!req.access?.isAdmin || hasLevel(req.access?.permissions?.[Screen.SCHEDULE], AccessLevel.EDIT) });

@ApiTags('Agenda de voluntariado')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Controller('schedule')
export class VolunteerScheduleController {
  constructor(private readonly scheduleService: VolunteerScheduleService) {}

  @Get()
  @RequireAccess(Screen.SCHEDULE, AccessLevel.VIEW)
  @ApiOperation({ summary: 'Mês da agenda', description: 'Acesso: Agenda (Visualizar). `month=AAAA-MM`. Nomes só para a equipe Admin; o próprio voluntário aparece como "Você".' })
  month(@Query('month') month: string, @Req() req) {
    return this.scheduleService.month(req.user.organizationId, month, { userId: req.user.id, isAdmin: !!req.access?.isAdmin });
  }

  @Get('volunteers')
  @RequireAccess(Screen.SCHEDULE, AccessLevel.EDIT)
  @ApiOperation({ summary: 'Voluntários ativos para marcar por eles', description: 'Acesso: Agenda (Editar).' })
  volunteers(@Req() req) {
    return this.scheduleService.volunteers(req.user.organizationId);
  }

  @Post('shifts')
  @RequireAccess(Screen.SCHEDULE, AccessLevel.VIEW)
  @ApiOperation({ summary: 'Marcar horário', description: 'Acesso: Agenda (Visualizar) para si; `userId` exige Agenda (Editar). seg–sex 08:00–16:00 e sáb/dom 13:00–16:00, de amanhã até 60 dias, sem cruzar horário da mesma pessoa.' })
  book(@Body() dto: CreateShiftDto, @Req() req) {
    return this.scheduleService.book({ ...dto, organizationId: req.user.organizationId }, actorOf(req));
  }

  @Patch('shifts/:id')
  @RequireAccess(Screen.SCHEDULE, AccessLevel.VIEW)
  @ApiOperation({ summary: 'Trocar horário', description: 'Acesso: Agenda (Visualizar) no próprio, até 24h antes; Agenda (Editar) em qualquer um.' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ShiftTimesDto, @Req() req) {
    return this.scheduleService.update(id, req.user.organizationId, dto, actorOf(req));
  }

  @Delete('shifts/:id')
  @RequireAccess(Screen.SCHEDULE, AccessLevel.VIEW)
  @ApiOperation({ summary: 'Desmarcar horário', description: 'Acesso: Agenda (Visualizar) no próprio, até 24h antes; Agenda (Editar) em qualquer um.' })
  cancel(@Param('id', ParseUUIDPipe) id: string, @Req() req) {
    return this.scheduleService.cancel(id, req.user.organizationId, actorOf(req));
  }

  @Post('locks')
  @RequireAccess(Screen.SCHEDULE, AccessLevel.EDIT)
  @ApiOperation({ summary: 'Trancar dia', description: 'Acesso: Agenda (Editar). Desmarca quem estava no dia e avisa por e-mail.' })
  lock(@Body() dto: CreateScheduleLockDto, @Req() req) {
    return this.scheduleService.lock(req.user.organizationId, dto.date, dto.message, req.user.id);
  }

  @Delete('locks/:id')
  @RequireAccess(Screen.SCHEDULE, AccessLevel.EDIT)
  @ApiOperation({ summary: 'Destrancar dia', description: 'Acesso: Agenda (Editar).' })
  unlock(@Param('id', ParseUUIDPipe) id: string, @Req() req) {
    return this.scheduleService.unlock(id, req.user.organizationId);
  }
}
