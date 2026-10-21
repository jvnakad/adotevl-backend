import { IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export const MAX_PAGE_LIMIT = 100;
/** Página máxima: evita OFFSET gigante (estouro de inteiro no Postgres, 500) */
export const MAX_PAGE = 100000;

export class PaginationDto {
  @ApiPropertyOptional({ default: 1, description: 'Número da página' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE, { message: `page deve ser no máximo ${MAX_PAGE}.` })
  page?: number = 1;

  @ApiPropertyOptional({ default: 10, maximum: MAX_PAGE_LIMIT, description: 'Itens por página (máximo 100; valores maiores são limitados a 100)' })
  @IsOptional()
  @Type(() => Number)
  // Acima do máximo limita em silêncio, sem erro; 0, negativo e não inteiro continuam recusados pelos validadores
  @Transform(({ value }) => (typeof value === 'number' && value > MAX_PAGE_LIMIT ? MAX_PAGE_LIMIT : value))
  @IsInt()
  @Min(1)
  limit?: number = 10;
}
