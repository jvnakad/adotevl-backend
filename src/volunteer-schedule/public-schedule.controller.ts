import { Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { VolunteerScheduleService } from './volunteer-schedule.service';
import { ScheduleAccessService } from './schedule-access.service';
import { ScheduleInstitutionService } from './schedule-institution.service';
import { CancelShiftByTokenDto, PublicCreateShiftDto, RequestScheduleCodeDto, VerifyScheduleCodeDto } from './dto/schedule.dto';

/**
 * Agenda na LP. Sem identificação: só "Voluntário" + horário. Para marcar: código por e-mail →
 * sessão de 2h (header Authorization: Bearer <token>), sempre para o próprio voluntário.
 */
@ApiTags('Agenda de voluntariado (pública)')
@Controller('public/schedule')
export class PublicScheduleController {
  constructor(
    private readonly scheduleService: VolunteerScheduleService,
    private readonly accessService: ScheduleAccessService,
    private readonly institutions: ScheduleInstitutionService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Mês da agenda (LP)', description: 'Rota pública. `organizationId` e `month=AAAA-MM`. Nunca traz nomes; com a sessão, os horários do próprio voluntário vêm com `mine` e `id`.' })
  month(@Query('organizationId') organizationId: string, @Query('month') month: string, @Headers('authorization') authorization?: string) {
    const session = this.accessService.optionalSession(authorization);
    const userId = session?.organizationId === organizationId ? session.userId : null;
    return this.scheduleService.month(organizationId, month, { userId, isAdmin: false });
  }

  @Get('institutions')
  // Dado público só de leitura: limite próprio e mais folgado (redes de campus compartilham IP); code/verify/shifts seguem no padrão
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @UseGuards(ThrottlerGuard)
  @ApiOperation({ summary: 'Faculdades do programa (LP)', description: 'Rota pública. `organizationId`. Só as ativas, em ordem alfabética: `[{ id, name }]`.' })
  findInstitutions(@Query('organizationId', ParseUUIDPipe) organizationId: string) {
    return this.institutions.findActive(organizationId);
  }

  @Post('code')
  @UseGuards(ThrottlerGuard)
  @ApiOperation({ summary: 'Pedir código por e-mail', description: 'Rota pública. `{ status, message }`: SENT (código enviado), NOT_VOLUNTEER (e-mail sem cadastro: a LP oferece o cadastro de volante) ou PENDING (cadastro em análise ou inativo).' })
  requestCode(@Body() dto: RequestScheduleCodeDto) {
    return this.accessService.requestCode(dto.email, dto.organizationId);
  }

  @Post('verify')
  @UseGuards(ThrottlerGuard)
  @ApiOperation({ summary: 'Validar código', description: 'Rota pública. Devolve `{ token, firstName, program }` (sessão de 2h da agenda). `program` = último programa usado `{ institutionId, institutionName, course }` ou null; faculdade inativa vem com institutionId/institutionName null e o curso preservado.' })
  verify(@Body() dto: VerifyScheduleCodeDto) {
    return this.accessService.verify(dto.email, dto.code, dto.organizationId);
  }

  @Post('shifts')
  @UseGuards(ThrottlerGuard)
  @ApiOperation({ summary: 'Marcar horário (LP)', description: 'Sessão da agenda. Mesmas regras do sistema. Cada marcação consome o código: outro horário exige novo código (401).' })
  async book(@Body() dto: PublicCreateShiftDto, @Headers('authorization') authorization: string) {
    const { userId, organizationId, codeId } = this.accessService.session(authorization);
    await this.accessService.assertCanBook(codeId);
    const shift = await this.scheduleService.book({ ...dto, organizationId }, { id: userId, canManage: false, public: true });
    // Só consome depois de marcar: erro de validação (horário cruzado, dia trancado) não gasta o código
    await this.accessService.markBooked(codeId);
    return shift;
  }

  @Delete('shifts/:id')
  @ApiOperation({ summary: 'Desmarcar horário (LP)', description: 'Sessão da agenda. Até 24h antes.' })
  cancel(@Param('id', ParseUUIDPipe) id: string, @Headers('authorization') authorization: string) {
    const { userId, organizationId } = this.accessService.session(authorization);
    return this.scheduleService.cancel(id, organizationId, { id: userId, canManage: false, public: true });
  }

  @Post('cancel')
  @UseGuards(ThrottlerGuard)
  @ApiOperation({ summary: 'Desmarcar pelo link do e-mail', description: 'Rota pública. Até 24h antes.' })
  cancelByToken(@Body() dto: CancelShiftByTokenDto) {
    return this.scheduleService.cancelByToken(dto.token);
  }
}
