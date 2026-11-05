import { BadRequestException } from '@nestjs/common';

// Pet já doado por outra ficha concluída: não pode ser vinculado, ter termo gerado nem ser concluído
export const PET_ALREADY_ADOPTED = 'PET_ALREADY_ADOPTED';

// Só pode haver um termo vivo (enviado/assinado) por pet
export const PET_IN_OTHER_CONTRACT = 'PET_IN_OTHER_CONTRACT';

export class PetInOtherContractException extends BadRequestException {
  constructor(petName: string, otherAdopterName?: string) {
    super({
      statusCode: 400,
      code: PET_IN_OTHER_CONTRACT,
      message: `O pet ${petName} já tem um termo de adoção em andamento em outra ficha${otherAdopterName ? ` (${otherAdopterName})` : ''}. Cancele aquele termo ou escolha outro pet.`,
    });
  }
}

export class PetAlreadyAdoptedException extends BadRequestException {
  constructor(petName?: string) {
    super({
      statusCode: 400,
      code: PET_ALREADY_ADOPTED,
      message: `${petName ? `O pet ${petName}` : 'O pet'} já foi adotado por outra ficha. Escolha outro pet ou reprove esta ficha.`,
    });
  }
}
