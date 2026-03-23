import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateProfileDto {
  @IsString()
  @IsNotEmpty({ message: 'O nome do perfil é obrigatório.' })
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}
