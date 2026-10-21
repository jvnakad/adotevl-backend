import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { MAX_PAGE_LIMIT } from '../../common/pagination.dto';

export const DEFAULT_NOTIFICATIONS_LIMIT = 20;

export class FindNotificationsDto {
  @ApiPropertyOptional({ default: DEFAULT_NOTIFICATIONS_LIMIT, maximum: MAX_PAGE_LIMIT, description: 'Itens por página (1 a 100; acima limita a 100)' })
  @IsOptional()
  @Type(() => Number)
  @Transform(({ value }) => (typeof value === 'number' && value > MAX_PAGE_LIMIT ? MAX_PAGE_LIMIT : value))
  @IsInt({ message: 'limit deve ser um inteiro.' })
  @Min(1, { message: 'limit deve ser no mínimo 1.' })
  limit?: number;

  @ApiPropertyOptional({ description: 'Cursor opaco devolvido em nextCursor da página anterior' })
  @IsOptional()
  @IsString({ message: 'cursor inválido.' })
  @MaxLength(300, { message: 'cursor inválido.' })
  cursor?: string;

  @ApiPropertyOptional({ description: 'true = só as não lidas' })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean({ message: 'unread deve ser true ou false.' })
  unread?: boolean;
}
