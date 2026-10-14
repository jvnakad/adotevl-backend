import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsObject, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const MAX_CLAUSE_LENGTH = 20000;

export class ContractClauseDto {
  @ApiProperty({ description: 'Chave da cláusula no modelo (ex.: entrega, multa)' })
  @IsString({ message: 'Chave da cláusula inválida.' })
  key: string;

  @ApiProperty({ description: 'Posição da cláusula (a numeração é recalculada pela ordem)' })
  @IsInt({ message: 'Ordem da cláusula deve ser um número inteiro.' })
  order: number;

  @ApiProperty({ description: 'Texto da cláusula (linhas separadas por \\n; referências como {{clausula:<key>}})' })
  @IsString({ message: 'Texto da cláusula inválido.' })
  @MaxLength(MAX_CLAUSE_LENGTH, { message: `Texto da cláusula deve ter no máximo ${MAX_CLAUSE_LENGTH} caracteres.` })
  content: string;

  @ApiProperty({ description: 'Cláusula removida do contrato' })
  @IsBoolean({ message: 'Informe se a cláusula foi removida (true ou false).' })
  removed: boolean;
}

export class UpdateAdoptionContractDto {
  @ApiPropertyOptional({ description: 'Pet vinculado ao contrato (null desvincula)', nullable: true })
  @IsOptional()
  @IsUUID('all', { message: 'Pet inválido.' })
  petId?: string | null;

  @ApiPropertyOptional({
    description: 'Dados do contrato: { adopter: { name, age, birthDate, rg, cpf, email, phone, profession, address }, animal: { name, species (CANINA|FELINA), sex (MACHO|FEMEA), breed, coat, distinctiveMarks, age, castrated, vaccinated, temperament, usesMedication, medicationDetails }, signature: { city, date } }',
  })
  @IsOptional()
  @IsObject({ message: 'Dados do contrato inválidos.' })
  data?: Record<string, any>;

  @ApiPropertyOptional({ type: [ContractClauseDto], description: 'Todas as cláusulas do contrato' })
  @IsOptional()
  @IsArray({ message: 'Cláusulas devem ser uma lista.' })
  @ValidateNested({ each: true })
  @Type(() => ContractClauseDto)
  clauses?: ContractClauseDto[];
}
