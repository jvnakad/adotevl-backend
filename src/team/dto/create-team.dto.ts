import { IsNotEmpty, IsString } from 'class-validator';

export class CreateTeamDto {
  @IsString()
  @IsNotEmpty({ message: 'Informe o nome da equipe.' })
  name: string;
}
