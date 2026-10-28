import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

/** Corpo de `POST /auth/refresh` e `POST /auth/logout`. As mensagens nunca repetem o valor enviado (SEC-01). */
export class RefreshTokenDto {
  @ApiProperty({ description: 'Refresh token devolvido pelo login, pela renovação ou pela troca de senha (43 caracteres base64url, não é JWT)', example: '<refresh_token>' })
  @IsString({ message: 'Informe o token de renovação.' })
  @IsNotEmpty({ message: 'Informe o token de renovação.' })
  @MaxLength(512, { message: 'Token de renovação inválido.' })
  @Matches(/^[A-Za-z0-9_-]{43}$/, { message: 'Token de renovação inválido.' })
  refreshToken: string;
}
