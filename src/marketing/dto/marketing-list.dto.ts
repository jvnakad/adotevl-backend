import { IsBoolean, IsInt, IsOptional, Matches, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { COLOR_MESSAGE, COLOR_PATTERN, IsMarketingName, upperColor } from './marketing-text';

export class CreateMarketingListDto {
  @ApiProperty({ example: 'Pautas', description: 'Nome da fila (até 40 caracteres; único entre as filas da organização, sem diferenciar acento e maiúscula)' })
  @IsMarketingName(40, 'Informe o nome da fila.')
  name: string;

  @ApiProperty({ example: '#1570EF', description: 'Cor hex #RGB ou #RRGGBB (gravada como #RRGGBB)' })
  @Transform(upperColor)
  @Matches(COLOR_PATTERN, { message: COLOR_MESSAGE })
  color: string;

  @ApiPropertyOptional({ default: false, description: 'Fila final (ex.: Postado): card nela nunca fica atrasado. No máximo uma por organização; marcar tira a marca da anterior' })
  @IsOptional()
  @IsBoolean({ message: 'isFinal deve ser verdadeiro ou falso.' })
  isFinal?: boolean;
}

/** Edição parcial: campo ausente não muda. */
export class UpdateMarketingListDto {
  @ApiPropertyOptional({ description: 'Nome da fila' })
  @IsOptional()
  @IsMarketingName(40, 'Informe o nome da fila.')
  name?: string;

  @ApiPropertyOptional({ description: 'Cor hex #RGB ou #RRGGBB (gravada como #RRGGBB)' })
  @IsOptional()
  @Transform(upperColor)
  @Matches(COLOR_PATTERN, { message: COLOR_MESSAGE })
  color?: string;

  @ApiPropertyOptional({ description: 'Fila final' })
  @IsOptional()
  @IsBoolean({ message: 'isFinal deve ser verdadeiro ou falso.' })
  isFinal?: boolean;
}

/** Reordenar fila ou subtarefa dentro do próprio escopo. */
export class MoveByIndexDto {
  @ApiProperty({ example: 0, description: 'Índice de destino (base 0) entre os itens ativos, sem contar o item movido. Acima do tamanho = fim' })
  @IsInt({ message: 'Informe o índice de destino.' })
  @Min(0, { message: 'O índice de destino não pode ser negativo.' })
  index: number;
}
