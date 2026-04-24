import { IsString, IsOptional, IsUUID, IsEnum, IsDateString, IsUrl } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MedicalRecordType } from '../medical-record.entity';

export class CreateMedicalRecordDto {
  @ApiProperty({ description: 'ID do pet' })
  @IsUUID()
  petId: string;

  @ApiProperty({ description: 'Data da consulta (formato: YYYY-MM-DD)' })
  @IsDateString({}, { message: 'Informe uma data válida no formato YYYY-MM-DD.' })
  date: string;

  @ApiProperty({ enum: MedicalRecordType, description: 'Tipo: CONSULTA, VACINA, MEDICACAO, EXAME, PROCEDIMENTO' })
  @IsEnum(MedicalRecordType, { message: 'Tipo inválido. Use: CONSULTA, VACINA, MEDICACAO, EXAME ou PROCEDIMENTO.' })
  type: MedicalRecordType;

  @ApiProperty({ description: 'Descrição' })
  @IsString()
  description: string;

  @ApiPropertyOptional({ description: 'Nome do veterinário' })
  @IsOptional()
  @IsString()
  veterinarianName?: string;

  @ApiPropertyOptional({ description: 'Data da próxima consulta (formato: YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString({}, { message: 'Informe uma data válida no formato YYYY-MM-DD.' })
  nextDate?: string;

  @ApiPropertyOptional({ description: 'URL do anexo (receita, exame, etc.)' })
  @IsOptional()
  @IsUrl({}, { message: 'Informe uma URL válida.' })
  attachmentUrl?: string;
}
