import { Controller, Post, Get, Put, Delete, Param, Body, Query, Request, UseGuards, UseInterceptors, UploadedFiles, ParseUUIDPipe } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { PaginationDto } from '../common/pagination.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AccessGuard } from '../access/access.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { AdminOnly, RequireAccess } from '../access/access.decorator';
import { AccessLevel, hasLevel, Screen } from '../access/access';
import { AccessService } from '../access/access.service';
import { PetService, MAX_PET_PHOTOS, MAX_PHOTO_SIZE } from './pet.service';
import { CreatePetDto } from './dto/create-pet.dto';
import { UpdatePetDto } from './dto/update-pet.dto';
import { PET_BREEDS_BY_SPECIES, PET_SPECIES } from './pet-catalog';

@ApiTags('Pets')
@Controller('pets')
export class PetController {
  constructor(
    private readonly petService: PetService,
    private readonly accessService: AccessService,
  ) {}

  @Post()
  @RequireAccess(Screen.PETS, AccessLevel.EDIT)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AccessGuard)
  @ApiOperation({ summary: 'Cadastrar pet', description: 'Acesso: Pets (Editar)' })
  create(@Body() dto: CreatePetDto, @Request() req) {
    return this.petService.create({ ...dto, organizationId: req.user.organizationId }, req.user.id);
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Listar pets', description: 'Rota pública. Sem login, filtra pelo organizationId da URL e retorna apenas os dados exibidos no site (id, name, sex, age, size, castration, about e url das fotos). Com login e acesso a Pets (Visualizar), usa a organização do usuário e retorna o pet completo. Filtros: organizationId, species, sex, size, castration (true/false), status (DISPONIVEL, EM_PROCESSO, ADOTADO), search (nome ou raça)' })
  async findAll(
    @Query() pagination: PaginationDto,
    @Request() req,
    @Query('organizationId') organizationId?: string,
    @Query('species') species?: string,
    @Query('sex') sex?: string,
    @Query('size') size?: string,
    @Query('castration') castration?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    // Quem visualiza Pets recebe o pet completo; demais usuários e visitantes veem a versão pública
    const access = req.user ? await this.accessService.forUser(req.user.id) : null;
    if (access && (access.isAdmin || hasLevel(access.permissions[Screen.PETS], AccessLevel.VIEW))) {
      return this.petService.findAll(pagination, { organizationId: req.user.organizationId, species, sex, size, castration, status, search });
    }
    return this.petService.findAllPublic(pagination, { organizationId, species, sex, size, castration, status, search });
  }

  // Antes de :id para "options" não cair no ParseUUID/busca por id
  @Get('options')
  @ApiOperation({ summary: 'Catálogo de espécies e raças', description: 'Rota pública. Listas usadas nos selects do front e na validação do cadastro.' })
  options() {
    return { species: PET_SPECIES, breedsBySpecies: PET_BREEDS_BY_SPECIES };
  }

  @Get(':id')
  @RequireAccess(Screen.PETS, AccessLevel.VIEW)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AccessGuard)
  @ApiOperation({ summary: 'Buscar pet por ID', description: 'Acesso: Pets (Visualizar)' })
  findOne(@Param('id') id: string) {
    return this.petService.findOne(id);
  }

  @Put(':id')
  @RequireAccess(Screen.PETS, AccessLevel.EDIT)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AccessGuard)
  @ApiOperation({ summary: 'Atualizar pet', description: 'Acesso: Pets (Editar)' })
  update(@Param('id') id: string, @Body() dto: UpdatePetDto, @Request() req) {
    return this.petService.update(id, dto, req.user.id);
  }

  @Delete(':id')
  @AdminOnly()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AccessGuard)
  @ApiOperation({ summary: 'Desativar pet (soft delete)', description: 'Somente equipe Admin' })
  remove(@Param('id') id: string, @Request() req) {
    return this.petService.remove(id, req.user.id);
  }

  @Post(':id/photos')
  @RequireAccess(Screen.PETS, AccessLevel.EDIT)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AccessGuard)
  @UseInterceptors(FilesInterceptor('photos', MAX_PET_PHOTOS, { limits: { fileSize: MAX_PHOTO_SIZE } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { photos: { type: 'array', items: { type: 'string', format: 'binary' } } },
    },
  })
  @ApiOperation({ summary: 'Adicionar fotos ao pet', description: 'Acesso: Pets (Editar). Campo multipart "photos" (JPEG, PNG ou WEBP, até 5MB cada). Máximo de 10 fotos por pet. Retorna o pet com a lista "fotos" atualizada.' })
  addPhotos(@Param('id', ParseUUIDPipe) id: string, @UploadedFiles() files: Express.Multer.File[], @Request() req) {
    return this.petService.addPhotos(id, files, req.user.id);
  }

  @Delete(':id/photos/:photoId')
  @RequireAccess(Screen.PETS, AccessLevel.EDIT)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AccessGuard)
  @ApiOperation({ summary: 'Remover foto do pet', description: 'Acesso: Pets (Editar)' })
  removePhoto(@Param('id', ParseUUIDPipe) id: string, @Param('photoId', ParseUUIDPipe) photoId: string) {
    return this.petService.removePhoto(id, photoId);
  }
}
