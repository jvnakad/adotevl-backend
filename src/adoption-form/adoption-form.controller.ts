import {
  Controller,
  Post,
  Get,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Request,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  ParseUUIDPipe,
  ValidationPipe,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiBody, getSchemaPath, ApiExtraModels } from '@nestjs/swagger';
import { PaginationDto } from '../common/pagination.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AdoptionFormService, MAX_ADOPTION_FORM_PHOTOS, MAX_ADOPTION_PHOTO_SIZE } from './adoption-form.service';
import { CreateAdoptionFormDto } from './dto/create-adoption-form.dto';
import { UpdateAdoptionFormDto } from './dto/update-adoption-form.dto';
import { UpdateAdoptionFormStatusDto } from './dto/update-adoption-form-status.dto';

const photosInterceptor = () =>
  FilesInterceptor('photos', MAX_ADOPTION_FORM_PHOTOS, { limits: { fileSize: MAX_ADOPTION_PHOTO_SIZE } });

// O ValidationPipe global não converte tipos; aqui o multipart precisa virar number/boolean
const transformPipe = new ValidationPipe({ whitelist: true, transform: true });

@ApiTags('Fichas de adoção')
@ApiExtraModels(CreateAdoptionFormDto)
@Controller('adoption-forms')
export class AdoptionFormController {
  constructor(private readonly adoptionFormService: AdoptionFormService) {}

  @Post()
  @UseInterceptors(photosInterceptor())
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      allOf: [
        { $ref: getSchemaPath(CreateAdoptionFormDto) },
        {
          type: 'object',
          required: ['photos'],
          properties: { photos: { type: 'array', items: { type: 'string', format: 'binary' } } },
        },
      ],
    },
  })
  @ApiOperation({
    summary: 'Enviar ficha de adoção',
    description: `Rota pública (formulário /adocao do site). Multipart com as respostas e o campo "photos" com fotos da residência (1 a ${MAX_ADOPTION_FORM_PHOTOS}, JPEG, PNG ou WEBP, até 5MB cada). Retorna apenas id, status e data de envio.`,
  })
  create(@Body(transformPipe) dto: CreateAdoptionFormDto, @UploadedFiles() files: Express.Multer.File[]) {
    return this.adoptionFormService.create(dto, files);
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'VOLUNTEER')
  @ApiOperation({
    summary: 'Listar fichas de adoção',
    description: 'Perfis permitidos: ADMIN, VOLUNTEER. Lista as fichas da organização do usuário, mais recentes primeiro. Filtros: status (PENDENTE, APROVADO, REPROVADO, AGUARDANDO_ASSINATURA, CONCLUIDA), search (nome, email ou CPF)',
  })
  findAll(
    @Query() pagination: PaginationDto,
    @Request() req,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.adoptionFormService.findAll(pagination, req.user.organizationId, { status, search });
  }

  // Declarada antes de ':id' para "board" não ser tratado como id
  @Get('board')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'VOLUNTEER')
  @ApiOperation({
    summary: 'Kanban das fichas de adoção',
    description: 'Perfis permitidos: ADMIN, VOLUNTEER. Colunas na ordem PENDENTE, APROVADO, AGUARDANDO_ASSINATURA, CONCLUIDA, REPROVADO, com total e até 50 fichas resumidas (mais recentes primeiro). Filtro: search (nome, email ou CPF).',
  })
  board(@Request() req, @Query('search') search?: string) {
    return this.adoptionFormService.board(req.user.organizationId, search);
  }

  @Get(':id/history')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'VOLUNTEER')
  @ApiOperation({ summary: 'Histórico da ficha de adoção', description: 'Perfis permitidos: ADMIN, VOLUNTEER. Eventos da ficha, mais recentes primeiro.' })
  history(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.adoptionFormService.findHistory(id, req.user.organizationId);
  }

  @Get(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'VOLUNTEER')
  @ApiOperation({ summary: 'Buscar ficha de adoção por ID', description: 'Perfis permitidos: ADMIN, VOLUNTEER' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.adoptionFormService.findOne(id, req.user.organizationId);
  }

  @Put(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'VOLUNTEER')
  @ApiOperation({ summary: 'Atualizar respostas da ficha de adoção', description: 'Perfis permitidos: ADMIN, VOLUNTEER' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body(transformPipe) dto: UpdateAdoptionFormDto, @Request() req) {
    return this.adoptionFormService.update(id, dto, req.user.organizationId, req.user.id);
  }

  @Patch(':id/status')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'VOLUNTEER')
  @ApiOperation({
    summary: 'Mover ficha de adoção (status e observações)',
    description:
      'Perfis permitidos: ADMIN, VOLUNTEER. PENDENTE/APROVADO/REPROVADO são livres entre si; AGUARDANDO_ASSINATURA só pelo envio do termo ao Autentique; CONCLUIDA só quando o adotante assina (pet vira ADOTADO); de AGUARDANDO_ASSINATURA/CONCLUIDA só volta para APROVADO e apenas ADMIN (envio pendente no Autentique é cancelado).',
  })
  updateStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAdoptionFormStatusDto, @Request() req) {
    return this.adoptionFormService.updateStatus(id, dto, req.user.organizationId, req.user.id, req.user.profileName);
  }

  @Delete(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Remover ficha de adoção (soft delete)', description: 'Perfis permitidos: ADMIN' })
  remove(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.adoptionFormService.remove(id, req.user.organizationId, req.user.id);
  }

  @Post(':id/photos')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'VOLUNTEER')
  @UseInterceptors(photosInterceptor())
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { photos: { type: 'array', items: { type: 'string', format: 'binary' } } },
    },
  })
  @ApiOperation({ summary: 'Adicionar fotos à ficha de adoção', description: `Perfis permitidos: ADMIN, VOLUNTEER. Campo multipart "photos" (JPEG, PNG ou WEBP, até 5MB cada). Máximo de ${MAX_ADOPTION_FORM_PHOTOS} fotos por ficha.` })
  addPhotos(@Param('id', ParseUUIDPipe) id: string, @UploadedFiles() files: Express.Multer.File[], @Request() req) {
    return this.adoptionFormService.addPhotos(id, files, req.user.organizationId, req.user.id);
  }

  @Delete(':id/photos/:photoId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'VOLUNTEER')
  @ApiOperation({ summary: 'Remover foto da ficha de adoção', description: 'Perfis permitidos: ADMIN, VOLUNTEER' })
  removePhoto(@Param('id', ParseUUIDPipe) id: string, @Param('photoId', ParseUUIDPipe) photoId: string, @Request() req) {
    return this.adoptionFormService.removePhoto(id, photoId, req.user.organizationId, req.user.id);
  }
}
