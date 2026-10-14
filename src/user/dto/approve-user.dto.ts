import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class ApproveUserDto {
  @ApiProperty({ description: 'Equipe do voluntário (define o acesso às telas)' })
  @IsUUID('4', { message: 'Escolha a equipe do voluntário.' })
  teamId: string;
}
