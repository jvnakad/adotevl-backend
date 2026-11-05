import { IsBoolean, IsOptional } from 'class-validator';
import { PartialType } from '@nestjs/swagger';
import { CreateVolunteerDto } from './create-volunteer.dto';

export class UpdateVolunteerDto extends PartialType(CreateVolunteerDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
