import { Controller, Post, Get, Body, HttpCode, Request, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { PasswordResetService } from './password-reset.service';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { VerifyResetCodeDto } from './dto/verify-reset-code.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PasswordResetThrottlerGuard } from './password-reset-throttler.guard';
import { RefreshTokenService } from './refresh-token.service';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JsonContentTypeGuard } from './json-content-type.guard';

const PER_MINUTE = 60_000;
const USER_AGENT_MAX = 255;

/** User-Agent truncado em 255: vai só para a tabela, nunca para log (SEC-14). */
const userAgentOf = (req): string | undefined => (typeof req.headers?.['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, USER_AGENT_MAX) : undefined);

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly passwordReset: PasswordResetService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  @Post('login')
  @UseGuards(PasswordResetThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: PER_MINUTE } })
  @ApiOperation({
    summary: 'Autenticação',
    description: 'Rota pública. Devolve o access token (JWT de 15 min, com `fid`) e o refresh token ("<refresh_token>", opaco, 7 dias, rotacionado a cada uso). Abre uma família nova. Limite de 10 por minuto por IP.',
  })
  login(@Body() dto: LoginDto, @Request() req) {
    return this.authService.login(dto, userAgentOf(req));
  }

  @Post('refresh')
  @HttpCode(200)
  @UseGuards(PasswordResetThrottlerGuard, JsonContentTypeGuard)
  @Throttle({ default: { limit: 30, ttl: PER_MINUTE } })
  @ApiOperation({
    summary: 'Renovar a sessão',
    description:
      'Rota pública (exige refresh token). Lê só `refreshToken` do corpo (application/json), nunca o header Authorization. Devolve um par novo da mesma família; o refresh usado deixa de valer. Toda recusa responde o mesmo 401 "Sessão expirada. Faça login novamente.". Limite de 30 por minuto por IP.',
  })
  refresh(@Body() dto: RefreshTokenDto, @Request() req) {
    return this.refreshTokens.rotate(dto.refreshToken, { userAgent: userAgentOf(req), ip: req.ip });
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(PasswordResetThrottlerGuard, JsonContentTypeGuard)
  @Throttle({ default: { limit: 30, ttl: PER_MINUTE } })
  @ApiOperation({
    summary: 'Encerrar a sessão',
    description: 'Rota pública (exige refresh token). Idempotente: revoga a família do refresh informado e responde 204 também para token desconhecido, vencido ou já revogado. Limite de 30 por minuto por IP.',
  })
  async logout(@Body() dto: RefreshTokenDto): Promise<void> {
    await this.refreshTokens.revokeFamily(dto.refreshToken);
  }

  @Post('forgot-password')
  @HttpCode(200)
  @UseGuards(PasswordResetThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: PER_MINUTE } })
  @ApiOperation({
    summary: 'Esqueci minha senha: pedir código',
    description: 'Rota pública. Responde sempre 200 com a mesma mensagem, exista o e-mail ou não. Só conta ativa, confirmada, aprovada e com equipe que não seja Voluntário Volante recebe o código (6 dígitos, 5 minutos). Limite de 5 por minuto por IP.',
  })
  forgotPassword(@Body() dto: ForgotPasswordDto, @Request() req) {
    return this.passwordReset.requestCode(dto.email, req.ip);
  }

  @Post('forgot-password/verify')
  @HttpCode(200)
  @UseGuards(PasswordResetThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: PER_MINUTE } })
  @ApiOperation({
    summary: 'Esqueci minha senha: validar código',
    description: 'Rota pública. 200 com { resetToken } (válido por 10 minutos, uso único) ou 400 "Código inválido ou expirado.", sempre igual. Limite de 10 por minuto por IP.',
  })
  verifyResetCode(@Body() dto: VerifyResetCodeDto) {
    return this.passwordReset.verifyCode(dto.email, dto.code);
  }

  @Post('reset-password')
  @HttpCode(200)
  @UseGuards(PasswordResetThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: PER_MINUTE } })
  @ApiOperation({
    summary: 'Esqueci minha senha: gravar a nova senha',
    description: 'Rota pública, exige o resetToken da validação do código. Derruba todas as sessões abertas da conta. Limite de 5 por minuto por IP.',
  })
  resetPassword(@Body() dto: ResetPasswordDto, @Request() req) {
    return this.passwordReset.resetPassword(dto.resetToken, dto.password, req.ip);
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Dados do usuário logado', description: 'Retorna os dados do usuário autenticado.' })
  me(@Request() req) {
    return this.authService.me(req.user.id);
  }
}
