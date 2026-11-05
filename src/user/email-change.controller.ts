import { Controller, Post, Delete, Body, HttpCode, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PasswordResetThrottlerGuard } from '../auth/password-reset-throttler.guard';
import { EmailChangeService } from './email-change.service';
import { RequestEmailChangeDto } from './dto/request-email-change.dto';
import { ConfirmEmailChangeDto } from './dto/confirm-email-change.dto';

const PER_MINUTE = 60_000;

/** Troca do próprio e-mail (docs/api/troca-email.md). Só JwtAuthGuard: opera sempre sobre `req.user.id`. */
@ApiTags('Usuários')
@ApiBearerAuth()
// Throttle por IP antes do JWT: é só atrito, o controle real é por conta (no service)
@UseGuards(PasswordResetThrottlerGuard, JwtAuthGuard)
@Controller('users/me/email-change')
export class EmailChangeController {
  constructor(private readonly emailChange: EmailChangeService) {}

  @Post()
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: PER_MINUTE } })
  @ApiOperation({
    summary: 'Trocar o próprio e-mail: pedir',
    description: 'Qualquer usuário logado (só o próprio e-mail). Exige a senha atual. Envia um código de 6 dígitos (5 minutos) ao e-mail NOVO; o atual vale até a confirmação. Limite de 5 por minuto por IP.',
  })
  request(@Body() dto: RequestEmailChangeDto, @Req() req) {
    return this.emailChange.request(req.user.id, dto, req.ip);
  }

  @Post('resend')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: PER_MINUTE } })
  @ApiOperation({
    summary: 'Trocar o próprio e-mail: reenviar o código',
    description: 'Qualquer usuário logado (só o próprio e-mail). Código novo para o mesmo e-mail novo, sem pedir a senha, dentro de 30 minutos do pedido. Reenvio só depois de 60 s. Limite de 5 por minuto por IP.',
  })
  resend(@Req() req) {
    return this.emailChange.resend(req.user.id);
  }

  @Post('confirm')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: PER_MINUTE } })
  @ApiOperation({
    summary: 'Trocar o próprio e-mail: confirmar com o código',
    description: 'Qualquer usuário logado (só o próprio e-mail). Troca o e-mail e derruba TODAS as sessões da conta, inclusive a atual (sem token novo). Limite de 10 por minuto por IP.',
  })
  confirm(@Body() dto: ConfirmEmailChangeDto, @Req() req) {
    return this.emailChange.confirm(req.user.id, dto.code, req.ip);
  }

  @Delete()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: PER_MINUTE } })
  @ApiOperation({
    summary: 'Trocar o próprio e-mail: cancelar',
    description: 'Qualquer usuário logado (só o próprio e-mail). Encerra o pedido pendente; responde 200 mesmo sem pedido. Limite de 10 por minuto por IP.',
  })
  cancel(@Req() req) {
    return this.emailChange.cancel(req.user.id);
  }
}
