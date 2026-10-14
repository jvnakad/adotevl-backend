import { OmitType, PartialType } from '@nestjs/swagger';
import { BirthMonth, CreatePetDto } from './create-pet.dto';

// Tudo opcional, menos o nascimento: o formulário sempre envia (pets antigos sem data precisam preencher)
export class UpdatePetDto extends PartialType(OmitType(CreatePetDto, ['birthDate'] as const)) {
  @BirthMonth()
  birthDate: string;
}
