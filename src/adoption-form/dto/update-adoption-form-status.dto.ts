import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AdoptionFormStatus } from '../adoption-form.entity';

export class UpdateAdoptionFormStatusDto {
  @ApiProperty({ enum: AdoptionFormStatus, description: 'Status: PENDENTE, EM_ANALISE, APROVADO, REPROVADO' })
  @IsEnum(AdoptionFormStatus, { message: 'Status inválido. Use: PENDENTE, EM_ANALISE, APROVADO ou REPROVADO.' })
  status: AdoptionFormStatus;

  @ApiPropertyOptional({ description: 'Observações da avaliação' })
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Observações devem ter no máximo 2000 caracteres.' })
  reviewNotes?: string;
}
