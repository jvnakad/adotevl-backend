import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../common/pagination.dto';
import { IsIsoDate } from '../stock-date';

export class FindStockProductsDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Busca parcial pelo nome, sem diferenciar acento nem maiúscula' })
  @IsOptional()
  @IsString()
  @MaxLength(150, { message: 'Busca deve ter no máximo 150 caracteres.' })
  search?: string;

  @ApiPropertyOptional({ description: 'ID do tipo de produto' })
  @IsOptional()
  @IsUUID('all', { message: 'Tipo de produto inválido.' })
  productTypeId?: string;

  @ApiPropertyOptional({ description: 'Cadastrado a partir de (YYYY-MM-DD, dia local de Brasília, inclusivo)' })
  @IsOptional()
  @IsIsoDate({ message: 'Data inicial deve estar no formato YYYY-MM-DD.' })
  from?: string;

  @ApiPropertyOptional({ description: 'Cadastrado até (YYYY-MM-DD, dia local de Brasília, inclusivo)' })
  @IsOptional()
  @IsIsoDate({ message: 'Data final deve estar no formato YYYY-MM-DD.' })
  to?: string;
}
