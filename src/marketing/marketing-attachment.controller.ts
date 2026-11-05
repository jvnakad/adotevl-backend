import { Controller, Delete, Get, Param, ParseUUIDPipe, Post, Request, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AccessGuard } from '../access/access.guard';
import { RequireAccess } from '../access/access.decorator';
import { AccessLevel, Screen } from '../access/access';
import { MAX_FILES_PER_UPLOAD, MARKETING_ATTACHMENT_MAX_BYTES, MarketingAttachmentService } from './marketing-attachment.service';

@ApiTags('Marketing: anexos')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Controller('marketing/cards/:cardId/attachments')
export class MarketingAttachmentController {
  constructor(private readonly attachmentService: MarketingAttachmentService) {}

  @Get()
  @RequireAccess(Screen.MARKETING, AccessLevel.VIEW)
  @ApiOperation({ summary: 'Listar anexos do card', description: 'Acesso: Marketing (Visualizar). Com URL assinada de 1 hora (o link não é público).' })
  findAll(@Param('cardId', ParseUUIDPipe) cardId: string, @Request() req) {
    return this.attachmentService.findAll(cardId, req.user.organizationId);
  }

  @Post()
  @RequireAccess(Screen.MARKETING, AccessLevel.EDIT)
  @UseInterceptors(FilesInterceptor('files', MAX_FILES_PER_UPLOAD, { limits: { fileSize: MARKETING_ATTACHMENT_MAX_BYTES + 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { files: { type: 'array', items: { type: 'string', format: 'binary' } } } } })
  @ApiOperation({
    summary: 'Anexar arquivos ao card',
    description: 'Acesso: Marketing (Editar). Campo multipart "files" (até 10 por envio, 30 MB cada; imagem, vídeo, PDF, Office ou zip). Exatamente 30 MB passa; acima = 413.',
  })
  add(@Param('cardId', ParseUUIDPipe) cardId: string, @UploadedFiles() files: Express.Multer.File[], @Request() req) {
    return this.attachmentService.addFiles(cardId, files, req.user.id, req.user.organizationId);
  }

  @Delete(':attachmentId')
  @RequireAccess(Screen.MARKETING, AccessLevel.EDIT)
  @ApiOperation({ summary: 'Excluir anexo', description: 'Acesso: Marketing (Editar), só quem enviou o anexo ou a equipe Admin.' })
  remove(@Param('cardId', ParseUUIDPipe) cardId: string, @Param('attachmentId', ParseUUIDPipe) attachmentId: string, @Request() req) {
    return this.attachmentService.remove(cardId, attachmentId, req.user.id, req.user.organizationId, req.access.isAdmin);
  }
}
