import { BadRequestException, Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { DataSource } from 'typeorm';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PasswordResetThrottlerGuard } from '../auth/password-reset-throttler.guard';
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
    private readonly dataSource: DataSource,
  ) {}

  /**
   * ATENÇÃO (provisório): hoje existe uma única organização, então a LP pode omitir `organizationId` e a API usa a
   * organização ativa mais antiga. Quando houver mais de uma, a LP deverá sempre informar o id e este fallback precisa sair.
   */
  private async resolveOrganizationId(raw?: string): Promise<string> {
    if (raw !== undefined && raw !== '') {
      if (!isUUID(raw)) throw new BadRequestException('Organização inválida.');
      return raw;
    }
    const [row] = await this.dataSource.query('SELECT id FROM organizations WHERE "isActive" = true ORDER BY created_at ASC LIMIT 1');
    if (!row) throw new BadRequestException('Organização não encontrada.');
    return row.id;
  }

  @Get()
  @ApiOperation({ summary: 'Mês da agenda (LP)', description: 'Rota pública. `organizationId` e `month=AAAA-MM`. Nunca traz nomes; com a sessão, os horários do próprio voluntário vêm com `mine` e `id`.' })
  async month(@Query('organizationId') rawOrganizationId: string, @Query('month') month: string, @Headers('authorization') authorization?: string) {
    const organizationId = await this.resolveOrganizationId(rawOrganizationId);
    const session = await this.accessService.optionalSession(authorization);
    const userId = session?.organizationId === organizationId ? session.userId : null;
    return this.scheduleService.month(organizationId, month, { userId, isAdmin: false });
  }

  @Get('institutions')
  // Dado público só de leitura: limite próprio e mais folgado (redes de campus compartilham IP); code/verify/shifts seguem no padrão
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @UseGuards(PasswordResetThrottlerGuard)
  @ApiOperation({ summary: 'Faculdades do programa (LP)', description: 'Rota pública. `organizationId`. Só as ativas, em ordem alfabética: `[{ id, name }]`.' })
  async findInstitutions(@Query('organizationId') rawOrganizationId?: string) {
    return this.institutions.findActive(await this.resolveOrganizationId(rawOrganizationId));
  }

  @Post('code')
  @UseGuards(PasswordResetThrottlerGuard)
  @ApiOperation({ summary: 'Pedir código por e-mail', description: 'Rota pública. `{ status, message }`: SENT (código enviado), NOT_VOLUNTEER (e-mail sem cadastro: a LP oferece o cadastro de volante) ou PENDING (cadastro em análise ou inativo).' })
  requestCode(@Body() dto: RequestScheduleCodeDto) {
    return this.accessService.requestCode(dto.email, dto.organizationId);
  }

  @Post('verify')
  @UseGuards(PasswordResetThrottlerGuard)
  @ApiOperation({ summary: 'Validar código', description: 'Rota pública. Devolve `{ token, firstName, program }` (sessão de 2h da agenda). `program` = último programa usado `{ institutionId, institutionName, course }` ou null; faculdade inativa vem com institutionId/institutionName null e o curso preservado.' })
  verify(@Body() dto: VerifyScheduleCodeDto) {
    return this.accessService.verify(dto.email, dto.code, dto.organizationId);
  }

  @Post('shifts')
  @UseGuards(PasswordResetThrottlerGuard)
  @ApiOperation({ summary: 'Marcar horário (LP)', description: 'Sessão da agenda. Mesmas regras do sistema. Cada marcação consome o código: outro horário exige novo código (401).' })
  async book(@Body() dto: PublicCreateShiftDto, @Headers('authorization') authorization: string) {
    const { userId, organizationId, codeId } = await this.accessService.session(authorization);
    await this.accessService.assertCanBook(codeId);
    const shift = await this.scheduleService.book({ ...dto, organizationId }, { id: userId, canManage: false, public: true });
    // Só consome depois de marcar: erro de validação (horário cruzado, dia trancado) não gasta o código
    await this.accessService.markBooked(codeId);
    return shift;
  }

  @Delete('shifts/:id')
  @ApiOperation({ summary: 'Desmarcar horário (LP)', description: 'Sessão da agenda. Até 24h antes.' })
  async cancel(@Param('id', ParseUUIDPipe) id: string, @Headers('authorization') authorization: string) {
    const { userId, organizationId } = await this.accessService.session(authorization);
    return this.scheduleService.cancel(id, organizationId, { id: userId, canManage: false, public: true });
  }

  @Post('cancel')
  @UseGuards(PasswordResetThrottlerGuard)
  @ApiOperation({ summary: 'Desmarcar pelo link do e-mail', description: 'Rota pública. Até 24h antes.' })
  cancelByToken(@Body() dto: CancelShiftByTokenDto) {
    return this.scheduleService.cancelByToken(dto.token);
  }
}
