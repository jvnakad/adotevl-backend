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
import { PasswordResetService } from './password-reset.service';
import { PasswordResetCode } from './password-reset-code.entity';
import { User } from '../user/user.entity';

@Global()
@Module({
  imports: [
    UserModule,
    PassportModule,
    TypeOrmModule.forFeature([User, PasswordResetCode]),
    // Limite por IP das rotas do "Esqueci minha senha" (@Throttle por rota); o controle real é por conta, no banco
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 5 }]),
    // Sem fallback: com JWT_SECRET ausente ou fraco o boot falha aqui
    JwtModule.registerAsync({
      useFactory: () => ({ secret: jwtSecret(), signOptions: { expiresIn: '8h' } }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordResetService, JwtStrategy, JwtAuthGuard, RolesGuard],
  exports: [JwtAuthGuard, RolesGuard, JwtModule],
})
export class AuthModule {}
