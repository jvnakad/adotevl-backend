import { BadRequestException } from '@nestjs/common';

// Pet já doado por outra ficha concluída: não pode ser vinculado, ter termo gerado nem ser concluído
export const PET_ALREADY_ADOPTED = 'PET_ALREADY_ADOPTED';

export class PetAlreadyAdoptedException extends BadRequestException {
  constructor(petName?: string) {
    super({
      statusCode: 400,
      code: PET_ALREADY_ADOPTED,
      message: `${petName ? `O pet ${petName}` : 'O pet'} já foi adotado por outra ficha. Escolha outro pet ou reprove esta ficha.`,
    });
  }
}
