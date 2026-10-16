import { IsDefined, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ProductUnit } from '../product.entity';
import { IsIsoDate } from '../stock-date';
import { trimName } from './create-product-type.dto';
import { IsEntityName } from './is-entity-name';

// Observações: remove em silêncio os caracteres de controle (Cc, exceto \n \r \t), aparando as pontas; vazio vira null (RN-19)
const CONTROL_CHARS = /(?![\n\r\t])\p{Cc}/gu;
const trimNotes = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.replace(CONTROL_CHARS, '').trim();
  return trimmed === '' ? null : trimmed;
};

export class CreateProductDto {
  @ApiProperty({ example: 'Ração Premium', description: 'Nome do produto (até 250 caracteres; único entre os produtos ativos da organização)' })
  @Transform(trimName)
  @IsEntityName('Informe o nome do produto.')
  name: string;

  @ApiProperty({ description: 'ID do tipo de produto (ativo)' })
  @IsUUID('all', { message: 'Escolha o tipo de produto.' })
  productTypeId: string;

  @ApiProperty({ enum: ProductUnit, description: 'Unidade de medida' })
  @IsEnum(ProductUnit, { message: 'Escolha a unidade de medida.' })
  unit: ProductUnit;

  // Validada no service junto com a unidade (precisa dela e, no PATCH, da unidade atual)
  @ApiProperty({ example: '10.500', description: 'Quantidade (string ou número, ponto decimal, até 3 casas; inteira em UNIT; 0 a 999999999.999)' })
  @IsDefined({ message: 'Informe a quantidade.' })
  quantity: string | number;

  @ApiPropertyOptional({ example: '2026-12-31', nullable: true, description: 'Data de vencimento (YYYY-MM-DD)' })
  @IsOptional()
  @IsIsoDate({ message: 'Informe uma data válida.' })
  expirationDate?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Observações (até 1.000 caracteres)' })
  @IsOptional()
  @Transform(trimNotes)
  @IsString({ message: 'As observações devem ser um texto.' })
  @MaxLength(1000, { message: 'As observações podem ter até 1.000 caracteres.' })
  notes?: string | null;
}

/** Edição parcial: campo ausente não muda; expirationDate e notes aceitam null para limpar. */
export class UpdateProductDto extends PartialType(CreateProductDto) {}
