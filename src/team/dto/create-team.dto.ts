import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateTeamDto {
  @IsString()
  @IsNotEmpty({ message: 'Informe o nome da equipe.' })
  name: string;

  // Ignorado nas rotas: a organização vem do usuário logado
  @IsUUID()
  @IsOptional()
  organizationId?: string;
}
