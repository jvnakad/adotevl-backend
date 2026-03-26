import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrganizationAddress } from './organization-address.entity';
import { OrganizationAddressService } from './organization-address.service';
import { OrganizationAddressController } from './organization-address.controller';

@Module({
  imports: [TypeOrmModule.forFeature([OrganizationAddress])],
  controllers: [OrganizationAddressController],
  providers: [OrganizationAddressService],
})
export class OrganizationAddressModule {}
