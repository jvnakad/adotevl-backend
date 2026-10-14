import { Controller, Post, Get, Put, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrganizationAddressService } from './organization-address.service';
import { CreateOrganizationAddressDto } from './dto/create-organization-address.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AccessGuard } from '../access/access.guard';
import { AdminOnly } from '../access/access.decorator';

@ApiTags('Endereços da organização')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Controller('organization-addresses')
export class OrganizationAddressController {
  constructor(private readonly addressService: OrganizationAddressService) {}

  @Post()
  @AdminOnly()
  @ApiOperation({ summary: 'Criar endereço', description: 'Somente equipe Admin.' })
  create(@Body() dto: CreateOrganizationAddressDto) {
    return this.addressService.create(dto);
  }

  @Get('organization/:organizationId')
  @ApiOperation({ summary: 'Endereços da organização', description: 'Qualquer usuário logado.' })
  findByOrganization(@Param('organizationId') organizationId: string) {
    return this.addressService.findByOrganization(organizationId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar endereço', description: 'Qualquer usuário logado.' })
  findOne(@Param('id') id: string) {
    return this.addressService.findOne(id);
  }

  @Put(':id')
  @AdminOnly()
  @ApiOperation({ summary: 'Atualizar endereço', description: 'Somente equipe Admin.' })
  update(@Param('id') id: string, @Body() dto: Partial<CreateOrganizationAddressDto>) {
    return this.addressService.update(id, dto);
  }

  @Delete(':id')
  @AdminOnly()
  @ApiOperation({ summary: 'Remover endereço', description: 'Somente equipe Admin.' })
  remove(@Param('id') id: string) {
    return this.addressService.remove(id);
  }
}
