import { IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ForgotPasswordDto } from './forgot-password.dto';

export class VerifyResetCodeDto extends ForgotPasswordDto {
  @ApiProperty({ description: 'Código de 6 dígitos recebido por e-mail (sem espaços)', example: '000000' })
  @IsString({ message: 'O código deve ter 6 dígitos numéricos.' })
  @Matches(/^\d{6}$/, { message: 'O código deve ter 6 dígitos numéricos.' })
  code: string;
}
