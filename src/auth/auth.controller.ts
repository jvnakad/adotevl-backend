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

const PER_MINUTE = 60_000;

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly passwordReset: PasswordResetService,
  ) {}

  @Post('login')
  @ApiOperation({ summary: 'Autenticação', description: 'Pública — retorna JWT para acesso ao sistema.' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
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
