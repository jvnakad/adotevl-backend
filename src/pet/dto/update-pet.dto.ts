import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { BirthMonth, CreatePetDto } from './create-pet.dto';

// Tudo opcional, menos o nascimento: o formulário sempre envia (pets antigos sem data precisam preencher)
export class UpdatePetDto extends PartialType(OmitType(CreatePetDto, ['birthDate'] as const)) {
  @BirthMonth()
  birthDate: string;

  @ApiPropertyOptional({ description: 'Ficha de adotante a vincular ao pet; só vale quando o status do pet fica EM_PROCESSO ou ADOTADO. Pet já ADOTADO por outra ficha: 400 PET_ALREADY_ADOPTED' })
  @IsOptional()
  @IsUUID('all', { message: 'Ficha de adoção inválida.' })
  adoptionFormId?: string;
}
