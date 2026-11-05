import { IsString, IsNotEmpty, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty({ description: 'Token devolvido pela validação do código' })
  @IsString({ message: 'Token de redefinição inválido.' })
  @IsNotEmpty({ message: 'Token de redefinição inválido.' })
  @MaxLength(2048, { message: 'Token de redefinição inválido.' })
  resetToken: string;

  @ApiProperty({ description: 'Nova senha (8 a 128 caracteres)' })
  @IsString({ message: 'A senha deve ter no mínimo 8 caracteres.' })
  @MinLength(8, { message: 'A senha deve ter no mínimo 8 caracteres.' })
  @MaxLength(128, { message: 'A senha deve ter no máximo 128 caracteres.' })
  password: string;
}
