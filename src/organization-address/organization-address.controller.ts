import { Controller, Post, Get, Put, Delete, Param, Body } from '@nestjs/common';
import { OrganizationAddressService } from './organization-address.service';
import { CreateOrganizationAddressDto } from './dto/create-organization-address.dto';

@Controller('organization-addresses')
export class OrganizationAddressController {
  constructor(private readonly addressService: OrganizationAddressService) {}

  @Post()
  create(@Body() dto: CreateOrganizationAddressDto) {
    return this.addressService.create(dto);
  }

  @Get('organization/:organizationId')
  findByOrganization(@Param('organizationId') organizationId: string) {
    return this.addressService.findByOrganization(organizationId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.addressService.findOne(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: Partial<CreateOrganizationAddressDto>) {
    return this.addressService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.addressService.remove(id);
  }
}
