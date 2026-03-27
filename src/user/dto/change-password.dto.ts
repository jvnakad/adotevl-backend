import { IsString, IsNotEmpty, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangePasswordDto {
  @ApiProperty({ description: 'Senha atual' })
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @ApiProperty({ description: 'Nova senha (mínimo 8 caracteres)' })
  @IsString()
  @IsNotEmpty()
  @MinLength(8, { message: 'A nova senha deve ter no mínimo 8 caracteres.' })
  newPassword: string;
}
