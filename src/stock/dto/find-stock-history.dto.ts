import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../common/pagination.dto';
import { StockHistoryType } from '../stock-history.entity';
import { IsIsoDate } from '../stock-date';

export class FindStockHistoryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Busca parcial pelo nome do produto ou tipo, por qualquer nome que o item já teve (sem acento nem maiúscula)' })
  @IsOptional()
  @IsString()
  @MaxLength(150, { message: 'Busca deve ter no máximo 150 caracteres.' })
  search?: string;

  @ApiPropertyOptional({ enum: StockHistoryType, description: 'Tipo do evento' })
  @IsOptional()
  @IsEnum(StockHistoryType, { message: 'Tipo de evento inválido.' })
  type?: StockHistoryType;

  @ApiPropertyOptional({ description: 'ID do usuário que fez a ação' })
  @IsOptional()
  @IsUUID('all', { message: 'Usuário inválido.' })
  userId?: string;

  @ApiPropertyOptional({ description: 'Data inicial (YYYY-MM-DD, dia local de Brasília, inclusiva)' })
  @IsOptional()
  @IsIsoDate({ message: 'Data inicial deve estar no formato YYYY-MM-DD.' })
  from?: string;

  @ApiPropertyOptional({ description: 'Data final (YYYY-MM-DD, dia local de Brasília, inclusiva)' })
  @IsOptional()
  @IsIsoDate({ message: 'Data final deve estar no formato YYYY-MM-DD.' })
  to?: string;
}
