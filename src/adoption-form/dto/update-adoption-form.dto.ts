import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateAdoptionFormDto } from './create-adoption-form.dto';

// Edição das respostas pela equipe: todos os campos opcionais; organização, termos aceitos e pet escolhido no formulário não mudam
export class UpdateAdoptionFormDto extends PartialType(
  OmitType(CreateAdoptionFormDto, ['organizationId', 'agreesWithTerms', 'declaresTruthful', 'desiredPetId'] as const),
) {}
