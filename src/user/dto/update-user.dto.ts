import { IsString, IsOptional, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateUserDto {
  @ApiPropertyOptional({ description: 'Nome completo' })
  @IsOptional()
  @IsString()
  fullName?: string;

  @ApiPropertyOptional({ description: 'Celular (somente números, com DDD)' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{10,11}$/, { message: 'O celular deve conter 10 ou 11 dígitos numéricos (com DDD, sem formatação).' })
  phone?: string;

  @ApiPropertyOptional({ description: 'ID do perfil' })
  @IsOptional()
  @IsString()
  profileId?: string;

  @ApiPropertyOptional({ description: 'Ativo/inativo' })
  @IsOptional()
  isActive?: boolean;
}
