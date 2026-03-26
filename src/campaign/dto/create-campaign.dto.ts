import { IsString, IsOptional, IsNumber, IsDateString, IsUUID } from 'class-validator';

export class CreateCampaignDto {
  @IsString()
  name: string;

  @IsNumber()
  fundraisingGoal: number;

  @IsString()
  @IsOptional()
  description?: string;

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsString()
  @IsOptional()
  imagePath?: string;

  @IsUUID()
  organizationId: string;
}
