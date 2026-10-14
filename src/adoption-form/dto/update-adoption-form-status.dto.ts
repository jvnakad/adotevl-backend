import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AdoptionFormStatus } from '../adoption-form.entity';

export class UpdateAdoptionFormStatusDto {
  @ApiProperty({ enum: AdoptionFormStatus, description: 'Status: PENDENTE, EM_ANALISE, APROVADO, REPROVADO, CONTRATO_GERADO (só via geração do contrato), CONCLUIDA' })
  @IsEnum(AdoptionFormStatus, { message: 'Status inválido. Use: PENDENTE, EM_ANALISE, APROVADO, REPROVADO, CONTRATO_GERADO ou CONCLUIDA.' })
  status: AdoptionFormStatus;

  @ApiPropertyOptional({ description: 'Observações da avaliação' })
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Observações devem ter no máximo 2000 caracteres.' })
  reviewNotes?: string;
}
