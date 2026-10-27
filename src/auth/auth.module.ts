import { Module, Global } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UserModule } from '../user/user.module';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { jwtSecret } from './jwt-secret';
import { accessTokenTtl } from './panel-token';
import { PasswordResetService } from './password-reset.service';
import { RefreshTokenService } from './refresh-token.service';
import { PasswordResetCode } from './password-reset-code.entity';
import { RefreshToken } from './refresh-token.entity';
import { User } from '../user/user.entity';

@Global()
@Module({
  imports: [
    UserModule,
    PassportModule,
    TypeOrmModule.forFeature([User, PasswordResetCode, RefreshToken]),
    // Limite por IP das rotas do "Esqueci minha senha" (@Throttle por rota); o controle real é por conta, no banco
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 5 }]),
    // Sem fallback: com JWT_SECRET ausente ou fraco, ou ACCESS_TOKEN_TTL inválido, o boot falha aqui (o padrão do módulo é o TTL do access; só a aprovação passa 8h)
    JwtModule.registerAsync({
      useFactory: () => ({ secret: jwtSecret(), signOptions: { expiresIn: accessTokenTtl() } }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordResetService, RefreshTokenService, JwtStrategy, JwtAuthGuard, RolesGuard],
  exports: [JwtAuthGuard, RolesGuard, JwtModule, RefreshTokenService],
})
export class AuthModule {}
