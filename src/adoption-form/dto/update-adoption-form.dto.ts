import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateAdoptionFormDto } from './create-adoption-form.dto';

// Edição das respostas pela equipe: todos os campos opcionais; organização e termos aceitos não mudam
export class UpdateAdoptionFormDto extends PartialType(
  OmitType(CreateAdoptionFormDto, ['organizationId', 'agreesWithTerms', 'declaresTruthful'] as const),
) {}
