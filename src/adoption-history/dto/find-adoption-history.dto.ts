import { IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../common/pagination.dto';
import { AdoptionHistoryType } from '../adoption-history.entity';

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

export class FindAdoptionHistoryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: AdoptionHistoryType, description: 'Tipo do evento' })
  @IsOptional()
  @IsEnum(AdoptionHistoryType, { message: 'Tipo de evento inválido.' })
  type?: AdoptionHistoryType;

  @ApiPropertyOptional({ description: 'ID da ficha de adoção' })
  @IsOptional()
  @IsUUID('all', { message: 'Ficha de adoção inválida.' })
  adoptionFormId?: string;

  @ApiPropertyOptional({ description: 'Busca pelo nome do adotante' })
  @IsOptional()
  @IsString()
  @MaxLength(150, { message: 'Busca deve ter no máximo 150 caracteres.' })
  search?: string;

  @ApiPropertyOptional({ description: 'Data inicial (YYYY-MM-DD, inclusiva)' })
  @IsOptional()
  @Matches(DATE_FORMAT, { message: 'Data inicial deve estar no formato YYYY-MM-DD.' })
  from?: string;

  @ApiPropertyOptional({ description: 'Data final (YYYY-MM-DD, inclusiva)' })
  @IsOptional()
  @Matches(DATE_FORMAT, { message: 'Data final deve estar no formato YYYY-MM-DD.' })
  to?: string;
}
