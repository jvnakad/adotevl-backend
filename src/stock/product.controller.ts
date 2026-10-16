import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AccessGuard } from '../access/access.guard';
import { RequireAccess } from '../access/access.decorator';
import { AccessLevel, Screen } from '../access/access';
import { ProductService } from './product.service';
import { CreateProductDto, UpdateProductDto } from './dto/create-product.dto';
import { FindStockProductsDto } from './dto/find-stock-products.dto';

@ApiTags('Estoque: produtos')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Controller('stock/products')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Get()
  @RequireAccess(Screen.STOCK, AccessLevel.VIEW)
  @ApiOperation({
    summary: 'Listar produtos',
    description: 'Acesso: Estoque (Visualizar). Produtos ativos da organização, mais recentes primeiro. Filtros: search (nome), productTypeId, from/to (cadastro, YYYY-MM-DD, dia local de Brasília, inclusivos).',
  })
  findAll(@Query() query: FindStockProductsDto, @Request() req) {
    return this.productService.findAll(query, req.user.organizationId);
  }

  @Get(':id')
  @RequireAccess(Screen.STOCK, AccessLevel.VIEW)
  @ApiOperation({ summary: 'Buscar produto por ID', description: 'Acesso: Estoque (Visualizar)' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.productService.findOne(id, req.user.organizationId);
  }

  @Post()
  @RequireAccess(Screen.STOCK, AccessLevel.EDIT)
  @ApiOperation({ summary: 'Cadastrar produto', description: 'Acesso: Estoque (Editar)' })
  create(@Body() dto: CreateProductDto, @Request() req) {
    return this.productService.create(dto, req.user.id, req.user.organizationId);
  }

  @Patch(':id')
  @RequireAccess(Screen.STOCK, AccessLevel.EDIT)
  @ApiOperation({
    summary: 'Editar produto (parcial)',
    description: 'Acesso: Estoque (Editar). Sem mudança real não grava nem gera evento. Trocar a unidade sem enviar quantidade grava 0.',
  })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto, @Request() req) {
    return this.productService.update(id, dto, req.user.id, req.user.organizationId);
  }

  @Delete(':id')
  @RequireAccess(Screen.STOCK, AccessLevel.EDIT)
  @ApiOperation({ summary: 'Excluir produto (lógico)', description: 'Acesso: Estoque (Editar)' })
  remove(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.productService.remove(id, req.user.id, req.user.organizationId);
  }
}
