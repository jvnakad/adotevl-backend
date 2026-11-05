import { ArrayMaxSize, IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { IsSearchText } from '../../stock/dto/is-search-text';
import { ApiProperty, ApiPropertyOptional, IntersectionType } from '@nestjs/swagger';
import { PaginationDto } from '../../common/pagination.dto';
import { IsIsoDate } from '../../stock/stock-date';

export enum MarketingCardSort {
  DUE = 'due',
  TITLE = 'title',
  LIST = 'list',
  CREATED_AT = 'createdAt',
}

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

export enum CalendarDateField {
  DUE = 'due',
  PUBLISH = 'publish',
}

// ---- filtros comuns (C13): quadro, fila, Lista e calendário ----

/** Aceita `a,b` e o parâmetro repetido (`a=x&a=y`) e devolve a lista sem vazios. */
const toArray = ({ value }: { value: unknown }) => {
  if (value === undefined || value === null) return undefined;
  const parts = (Array.isArray(value) ? value : [value]).flatMap((item) => String(item).split(','));
  return parts.map((item) => item.trim()).filter(Boolean);
};

export class MarketingCardFilterDto {
  @ApiPropertyOptional({ description: 'Busca parcial pelo título (sem acento nem maiúscula)' })
  @IsOptional()
  @IsSearchText()
  q?: string;

  @ApiPropertyOptional({ type: [String], description: 'Cards em que QUALQUER um destes usuários é membro (responsável). Repita o parâmetro ou separe por vírgula' })
  @IsOptional()
  @Transform(toArray)
  @ArrayMaxSize(50, { message: 'No máximo 50 membros no filtro.' })
  @IsUUID('all', { each: true, message: 'Membro inválido.' })
  memberIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Cards que têm QUALQUER uma destas etiquetas' })
  @IsOptional()
  @Transform(toArray)
  @ArrayMaxSize(50, { message: 'No máximo 50 etiquetas no filtro.' })
  @IsUUID('all', { each: true, message: 'Etiqueta inválida.' })
  labelIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Cards em QUALQUER uma destas filas' })
  @IsOptional()
  @Transform(toArray)
  @ArrayMaxSize(50, { message: 'No máximo 50 filas no filtro.' })
  @IsUUID('all', { each: true, message: 'Fila inválida.' })
  listIds?: string[];

  @ApiPropertyOptional({ example: '2026-10-01', description: 'Criado a partir de (YYYY-MM-DD, dia de Brasília, inclusivo)' })
  @IsOptional()
  @IsIsoDate({ message: 'Informe a data inicial de criação no formato YYYY-MM-DD.' })
  createdFrom?: string;

  @ApiPropertyOptional({ description: 'Criado até (YYYY-MM-DD, inclusivo)' })
  @IsOptional()
  @IsIsoDate({ message: 'Informe a data final de criação no formato YYYY-MM-DD.' })
  createdTo?: string;

  @ApiPropertyOptional({ description: 'Prazo de entrega a partir de (YYYY-MM-DD, inclusivo)' })
  @IsOptional()
  @IsIsoDate({ message: 'Informe o prazo inicial no formato YYYY-MM-DD.' })
  dueFrom?: string;

  @ApiPropertyOptional({ description: 'Prazo de entrega até (YYYY-MM-DD, inclusivo)' })
  @IsOptional()
  @IsIsoDate({ message: 'Informe o prazo final no formato YYYY-MM-DD.' })
  dueTo?: string;

  @ApiPropertyOptional({ description: 'Data de publicação a partir de (YYYY-MM-DD, inclusivo)' })
  @IsOptional()
  @IsIsoDate({ message: 'Informe a publicação inicial no formato YYYY-MM-DD.' })
  publishFrom?: string;

  @ApiPropertyOptional({ description: 'Data de publicação até (YYYY-MM-DD, inclusivo)' })
  @IsOptional()
  @IsIsoDate({ message: 'Informe a publicação final no formato YYYY-MM-DD.' })
  publishTo?: string;
}

export class FindMarketingCardsDto extends IntersectionType(PaginationDto, MarketingCardFilterDto) {
  @ApiPropertyOptional({
    enum: MarketingCardSort,
    default: 'due',
    description: 'Ordenação. due (padrão, asc): atrasados primeiro, depois prazo crescente, sem prazo por último; title; list (ordem das filas); createdAt',
  })
  @IsOptional()
  @IsEnum(MarketingCardSort, { message: 'Ordenação inválida.' })
  sort?: MarketingCardSort;

  @ApiPropertyOptional({ enum: SortOrder, description: 'Sentido. Padrão asc (createdAt: desc). due desc = prazo mais distante primeiro, sem prazo por último' })
  @IsOptional()
  @IsEnum(SortOrder, { message: 'Sentido da ordenação inválido.' })
  order?: SortOrder;

  @ApiPropertyOptional({ enum: CalendarDateField, description: 'Só cards sem a data: due (sem prazo de entrega) ou publish (sem data de publicação)' })
  @IsOptional()
  @IsEnum(CalendarDateField, { message: 'without deve ser due ou publish.' })
  without?: CalendarDateField;
}

export class FindMarketingCalendarDto extends MarketingCardFilterDto {
  @ApiProperty({ example: '2026-11-01', description: 'Início do intervalo (YYYY-MM-DD, inclusivo)' })
  @IsIsoDate({ message: 'Informe a data inicial no formato YYYY-MM-DD.' })
  from: string;

  @ApiProperty({ example: '2026-11-30', description: 'Fim do intervalo (YYYY-MM-DD, inclusivo). Máximo de 370 dias' })
  @IsIsoDate({ message: 'Informe a data final no formato YYYY-MM-DD.' })
  to: string;

  @ApiPropertyOptional({ enum: CalendarDateField, default: 'due', description: 'Data usada no calendário: due (prazo de entrega) ou publish (publicação)' })
  @IsOptional()
  @IsEnum(CalendarDateField, { message: 'dateField deve ser due ou publish.' })
  dateField?: CalendarDateField;
}

export const DEFAULT_CARDS_PER_LIST = 20;
export const MAX_OFFSET = 1000000;

/** Quadro: filtros + quantos cards trazer por fila (primeira página). */
export class FindMarketingBoardDto extends MarketingCardFilterDto {
  @ApiPropertyOptional({ default: DEFAULT_CARDS_PER_LIST, maximum: 100, description: 'Cards por fila na primeira página (1 a 100; acima limita a 100)' })
  @IsOptional()
  @Type(() => Number)
  @Transform(({ value }) => (typeof value === 'number' && value > 100 ? 100 : value))
  @IsInt({ message: 'limit deve ser um inteiro.' })
  @Min(1, { message: 'limit deve ser no mínimo 1.' })
  limit?: number;
}

/** "Ver mais" de uma fila: offset/limit + os mesmos filtros. */
export class FindMarketingListCardsDto extends FindMarketingBoardDto {
  @ApiPropertyOptional({ default: 0, description: 'Quantos cards da fila (já filtrados) pular' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'offset deve ser um inteiro.' })
  @Min(0, { message: 'offset não pode ser negativo.' })
  @Max(MAX_OFFSET, { message: `offset deve ser no máximo ${MAX_OFFSET}.` })
  offset?: number;
}
