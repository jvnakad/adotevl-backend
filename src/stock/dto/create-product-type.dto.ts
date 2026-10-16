import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { normalizeDisplayName } from '../../common/normalize-name';
import { IsEntityName } from './is-entity-name';

// Espaços das pontas removidos e espaços repetidos reduzidos antes de validar o tamanho (RN-10)
export const trimName = ({ value }: { value: unknown }) => (typeof value === 'string' ? normalizeDisplayName(value) : value);

export class CreateProductTypeDto {
  @ApiProperty({ example: 'Ração', description: 'Nome do tipo (até 250 caracteres; único entre os tipos ativos da organização)' })
  @Transform(trimName)
  @IsEntityName('Informe o nome do tipo.')
  name: string;
}

/** Renomear: o nome é o único campo editável e continua obrigatório. */
export class UpdateProductTypeDto extends CreateProductTypeDto {}
