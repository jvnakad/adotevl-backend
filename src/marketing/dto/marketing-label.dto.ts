import { IsOptional, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { COLOR_MESSAGE, COLOR_PATTERN, IsMarketingName, upperColor } from './marketing-text';

export class CreateMarketingLabelDto {
  @ApiProperty({ example: 'Instagram', description: 'Nome da etiqueta (até 30 caracteres; único entre as etiquetas ativas da organização, sem diferenciar acento e maiúscula)' })
  @IsMarketingName(30, 'Informe o nome da etiqueta.')
  name: string;

  @ApiProperty({ example: '#E1306C', description: 'Cor hex #RGB ou #RRGGBB (gravada como #RRGGBB)' })
  @Transform(upperColor)
  @Matches(COLOR_PATTERN, { message: COLOR_MESSAGE })
  color: string;
}

export class UpdateMarketingLabelDto {
  @ApiPropertyOptional({ description: 'Nome da etiqueta' })
  @IsOptional()
  @IsMarketingName(30, 'Informe o nome da etiqueta.')
  name?: string;

  @ApiPropertyOptional({ description: 'Cor hex #RGB ou #RRGGBB (gravada como #RRGGBB)' })
  @IsOptional()
  @Transform(upperColor)
  @Matches(COLOR_PATTERN, { message: COLOR_MESSAGE })
  color?: string;
}
