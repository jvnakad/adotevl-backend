import { IsString, IsNotEmpty, IsEmail, IsOptional, Matches, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty({ message: 'O nome completo é obrigatório.' })
  fullName: string;

  @IsString()
  @IsNotEmpty({ message: 'O CPF é obrigatório.' })
  @Matches(/^\d{11}$/, {
    message: 'O CPF deve conter exatamente 11 dígitos numéricos (sem formatação).',
  })
  cpf: string;

  @IsEmail({}, { message: 'Informe um endereço de e-mail válido.' })
  @IsNotEmpty({ message: 'O e-mail é obrigatório.' })
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'A senha é obrigatória.' })
  @MinLength(8, { message: 'A senha deve ter no mínimo 8 caracteres.' })
  password: string;

  @IsString()
  @IsNotEmpty({ message: 'O perfil é obrigatório.' })
  profileId: string;

  @IsString()
  @IsNotEmpty({ message: 'A organização é obrigatória.' })
  organizationId: string;
}
