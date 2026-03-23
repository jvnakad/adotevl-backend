import { IsString, IsNotEmpty, IsOptional, Matches } from 'class-validator';

export class CreateOrganizationDto {
  @IsString()
  @IsNotEmpty({ message: 'O nome legal é obrigatório.' })
  legalName: string;

  @IsString()
  @IsNotEmpty({ message: 'O CNPJ é obrigatório.' })
  @Matches(/^\d{14}$/, {
    message: 'O CNPJ deve conter exatamente 14 dígitos numéricos (sem formatação).',
  })
  cnpj: string;

  @IsOptional()
  @IsString()
  description?: string;
}
