import { Controller, Post, Get, Put, Delete, Param, Body, Query, Request, UseGuards, UseInterceptors, UploadedFiles, ParseUUIDPipe } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { PaginationDto } from '../common/pagination.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PetService, MAX_PET_PHOTOS, MAX_PHOTO_SIZE } from './pet.service';
import { CreatePetDto } from './dto/create-pet.dto';

@ApiTags('Pets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('pets')
export class PetController {
  constructor(private readonly petService: PetService) {}

  @Post()
  @Roles('ADMIN', 'VOLUNTEER')
  @ApiOperation({ summary: 'Cadastrar pet', description: 'Perfis permitidos: ADMIN, VOLUNTEER' })
  create(@Body() dto: CreatePetDto, @Request() req) {
    return this.petService.create(dto, req.user.id);
  }

  @Get()
  @Roles('ADMIN', 'VOLUNTEER')
  @ApiOperation({ summary: 'Listar pets', description: 'Perfis permitidos: ADMIN, VOLUNTEER. Filtros: organizationId, species, sex, size, castration (true/false), status (DISPONIVEL, EM_PROCESSO, ADOTADO)' })
  findAll(
    @Query() pagination: PaginationDto,
    @Request() req,
    @Query('species') species?: string,
    @Query('sex') sex?: string,
    @Query('size') size?: string,
    @Query('castration') castration?: string,
    @Query('status') status?: string,
  ) {
    return this.petService.findAll(pagination, { organizationId: req.user.organizationId, species, sex, size, castration, status });
  }

  @Get(':id')
  @Roles('ADMIN', 'VOLUNTEER')
  @ApiOperation({ summary: 'Buscar pet por ID', description: 'Perfis permitidos: ADMIN, VOLUNTEER' })
  findOne(@Param('id') id: string) {
    return this.petService.findOne(id);
  }

  @Put(':id')
  @Roles('ADMIN', 'VOLUNTEER')
  @ApiOperation({ summary: 'Atualizar pet', description: 'Perfis permitidos: ADMIN, VOLUNTEER' })
  update(@Param('id') id: string, @Body() dto: Partial<CreatePetDto>, @Request() req) {
    return this.petService.update(id, dto, req.user.id);
  }

  @Delete(':id')
  @Roles('ADMIN', 'VOLUNTEER')
  @ApiOperation({ summary: 'Desativar pet (soft delete)', description: 'Perfis permitidos: ADMIN, VOLUNTEER' })
  remove(@Param('id') id: string, @Request() req) {
    return this.petService.remove(id, req.user.id);
  }

  @Post(':id/photos')
  @Roles('ADMIN', 'VOLUNTEER')
  @UseInterceptors(FilesInterceptor('photos', MAX_PET_PHOTOS, { limits: { fileSize: MAX_PHOTO_SIZE } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { photos: { type: 'array', items: { type: 'string', format: 'binary' } } },
    },
  })
  @ApiOperation({ summary: 'Adicionar fotos ao pet', description: 'Perfis permitidos: ADMIN, VOLUNTEER. Campo multipart "photos" (JPEG, PNG ou WEBP, até 5MB cada). Máximo de 10 fotos por pet. Retorna o pet com a lista "fotos" atualizada.' })
  addPhotos(@Param('id', ParseUUIDPipe) id: string, @UploadedFiles() files: Express.Multer.File[], @Request() req) {
    return this.petService.addPhotos(id, files, req.user.id);
  }

  @Delete(':id/photos/:photoId')
  @Roles('ADMIN', 'VOLUNTEER')
  @ApiOperation({ summary: 'Remover foto do pet', description: 'Perfis permitidos: ADMIN, VOLUNTEER' })
  removePhoto(@Param('id', ParseUUIDPipe) id: string, @Param('photoId', ParseUUIDPipe) photoId: string) {
    return this.petService.removePhoto(id, photoId);
  }
}
