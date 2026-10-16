import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { normalizeDisplayName } from '../../common/normalize-name';

// Espaços das pontas removidos e espaços repetidos reduzidos antes de validar o tamanho (RN-10)
export const trimName = ({ value }: { value: unknown }) => (typeof value === 'string' ? normalizeDisplayName(value) : value);

export class CreateProductTypeDto {
  @ApiProperty({ example: 'Ração', description: 'Nome do tipo (até 250 caracteres; único entre os tipos ativos da organização)' })
  @Transform(trimName)
  @IsString({ message: 'Informe o nome do tipo.' })
  @IsNotEmpty({ message: 'Informe o nome do tipo.' })
  @MaxLength(250, { message: 'O nome pode ter até 250 caracteres.' })
  name: string;
}

/** Renomear: o nome é o único campo editável e continua obrigatório. */
export class UpdateProductTypeDto extends CreateProductTypeDto {}
