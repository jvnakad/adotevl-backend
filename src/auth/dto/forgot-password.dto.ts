import { IsEmail, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// Mensagens fixas: nunca repetem o valor recebido (código, token ou senha)
export class ForgotPasswordDto {
  @ApiProperty({ description: 'E-mail da conta', example: 'voluntario@exemplo.com' })
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  @MaxLength(254, { message: 'O e-mail deve ter no máximo 254 caracteres.' })
  email: string;
}
