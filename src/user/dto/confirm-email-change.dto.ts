import { Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ConfirmEmailChangeDto {
  @ApiProperty({ description: 'Código de 6 dígitos enviado ao e-mail novo' })
  @Matches(/^\d{6}$/, { message: 'O código deve ter 6 dígitos.' })
  code: string;
}
