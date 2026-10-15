import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, Min, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateTutorialDto {
  @ApiPropertyOptional({ description: 'Chave do tour visto (ex.: PETS, PETS_MEDICAL_RECORDS, WELCOME)' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9_]{1,60}$/, { message: 'Chave do tour inválida.' })
  tour?: string;

  @ApiPropertyOptional({ description: 'Versão do tour vista (obrigatória com tour)' })
  @ValidateIf((dto) => dto.tour !== undefined)
  @IsInt({ message: 'Versão do tour deve ser um número inteiro.' })
  @Min(1, { message: 'Versão do tour deve ser no mínimo 1.' })
  @Max(1000, { message: 'Versão do tour deve ser no máximo 1000.' })
  version?: number;

  @ApiPropertyOptional({ description: 'true desliga os tours automáticos; false religa' })
  @IsOptional()
  @IsBoolean({ message: 'disabled deve ser verdadeiro ou falso.' })
  disabled?: boolean;
}
