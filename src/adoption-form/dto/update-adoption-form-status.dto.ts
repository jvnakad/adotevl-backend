import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AdoptionFormStatus } from '../adoption-form.entity';

export class UpdateAdoptionFormStatusDto {
  @ApiProperty({ enum: AdoptionFormStatus, description: 'Status manuais: PENDENTE, APROVADO, REPROVADO. AGUARDANDO_ASSINATURA e CONCLUIDA só via assinatura do termo no Autentique' })
  @IsEnum(AdoptionFormStatus, { message: 'Status inválido. Use: PENDENTE, APROVADO, REPROVADO, AGUARDANDO_ASSINATURA ou CONCLUIDA.' })
  status: AdoptionFormStatus;

  @ApiPropertyOptional({ description: 'Observações da avaliação' })
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Observações devem ter no máximo 2000 caracteres.' })
  reviewNotes?: string;

  @ApiPropertyOptional({ description: 'Pet a vincular à ficha ao mover o card (ignorado em fichas com termo enviado ou assinado). Pet já ADOTADO por outra ficha: 400 PET_ALREADY_ADOPTED' })
  @IsOptional()
  @IsUUID('all', { message: 'Pet inválido.' })
  petId?: string;
}
