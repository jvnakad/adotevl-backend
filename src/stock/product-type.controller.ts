import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AccessGuard } from '../access/access.guard';
import { RequireAccess } from '../access/access.decorator';
import { AccessLevel, Screen } from '../access/access';
import { PaginationDto } from '../common/pagination.dto';
import { ProductTypeService } from './product-type.service';
import { CreateProductTypeDto, UpdateProductTypeDto } from './dto/create-product-type.dto';

@ApiTags('Estoque: tipos de produto')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Controller('stock/product-types')
export class ProductTypeController {
  constructor(private readonly typeService: ProductTypeService) {}

  @Get()
  @RequireAccess(Screen.STOCK_PRODUCT_TYPES, AccessLevel.VIEW)
  @ApiOperation({ summary: 'Listar tipos de produto', description: 'Acesso: Tipos de produto (Visualizar). Paginado, tipos ativos em ordem alfabética (ignora acento e maiúscula).' })
  findAll(@Query() pagination: PaginationDto, @Request() req) {
    return this.typeService.findAll(pagination, req.user.organizationId);
  }

  // Declarada antes das rotas com :id
  @Get('options')
  @RequireAccess(Screen.STOCK, AccessLevel.VIEW)
  @ApiOperation({ summary: 'Opções de tipos ativos (id e nome)', description: 'Acesso: Estoque (Visualizar). Para o select do produto e o filtro por tipo; não paginado, em ordem alfabética.' })
  findOptions(@Request() req) {
    return this.typeService.findOptions(req.user.organizationId);
  }

  @Get(':id/usage')
  @RequireAccess(Screen.STOCK_PRODUCT_TYPES, AccessLevel.VIEW)
  @ApiOperation({ summary: 'Quantos produtos ativos usam o tipo', description: 'Acesso: Tipos de produto (Visualizar). Usado na confirmação de exclusão.' })
  usage(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.typeService.usage(id, req.user.organizationId);
  }

  @Post()
  @RequireAccess(Screen.STOCK_PRODUCT_TYPES, AccessLevel.EDIT)
  @ApiOperation({ summary: 'Cadastrar tipo de produto', description: 'Acesso: Tipos de produto (Editar)' })
  create(@Body() dto: CreateProductTypeDto, @Request() req) {
    return this.typeService.create(dto, req.user.id, req.user.organizationId);
  }

  @Patch(':id')
  @RequireAccess(Screen.STOCK_PRODUCT_TYPES, AccessLevel.EDIT)
  @ApiOperation({ summary: 'Renomear tipo de produto', description: 'Acesso: Tipos de produto (Editar). Nome igual ao gravado não altera nada nem gera evento.' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductTypeDto, @Request() req) {
    return this.typeService.update(id, dto, req.user.id, req.user.organizationId);
  }

  @Delete(':id')
  @RequireAccess(Screen.STOCK_PRODUCT_TYPES, AccessLevel.EDIT)
  @ApiOperation({ summary: 'Excluir tipo de produto (lógico)', description: 'Acesso: Tipos de produto (Editar). Permitido com produtos vinculados; eles mantêm o nome do tipo.' })
  remove(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.typeService.remove(id, req.user.id, req.user.organizationId);
  }
}
