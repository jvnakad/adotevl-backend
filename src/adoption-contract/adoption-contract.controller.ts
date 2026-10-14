import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AccessGuard } from '../access/access.guard';
import { AdminOnly, RequireAccess } from '../access/access.decorator';
import { AccessLevel, Screen } from '../access/access';
import { AdoptionContractService } from './adoption-contract.service';
import { UpdateAdoptionContractDto } from './dto/update-adoption-contract.dto';

// Rotas do contrato ficam sob a ficha: /adoption-forms/:id/contract
@ApiTags('Termo de adoção')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Controller('adoption-forms')
export class AdoptionContractController {
  constructor(private readonly contractService: AdoptionContractService) {}

  @Get(':id/contract')
  @RequireAccess(Screen.ADOPTION_CONTRACT, AccessLevel.VIEW)
  @ApiOperation({
    summary: 'Buscar termo de adoção da ficha',
    description: 'Acesso: Termo de adoção (Visualizar). Ficha APROVADO, AGUARDANDO_ASSINATURA ou CONCLUIDA. Na primeira chamada cria o rascunho a partir do modelo, pré-preenchido com a ficha e o pet vinculado.',
  })
  findOne(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.contractService.findByForm(id, req.user.organizationId, req.user.id);
  }

  @Put(':id/contract')
  @RequireAccess(Screen.ADOPTION_CONTRACT, AccessLevel.EDIT)
  @ApiOperation({
    summary: 'Salvar rascunho do termo de adoção',
    description: 'Acesso: Termo de adoção (Editar). Body { petId?, data?, clauses? }. clauses precisa conter todas as cláusulas; a de identificação do animal não pode ser removida. Cada alteração vira um evento no histórico.',
  })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAdoptionContractDto, @Request() req) {
    return this.contractService.update(id, dto, req.user.organizationId, req.user.id);
  }

  @Post(':id/contract/clauses/:key/reset')
  @RequireAccess(Screen.ADOPTION_CONTRACT, AccessLevel.EDIT)
  @ApiOperation({ summary: 'Restaurar texto original da cláusula', description: 'Acesso: Termo de adoção (Editar). Volta ao texto do modelo e reinclui a cláusula se estava removida.' })
  resetClause(@Param('id', ParseUUIDPipe) id: string, @Param('key') key: string, @Request() req) {
    return this.contractService.resetClause(id, key, req.user.organizationId, req.user.id);
  }

  @Post(':id/contract/generate')
  @RequireAccess(Screen.ADOPTION_CONTRACT, AccessLevel.EDIT)
  @ApiOperation({
    summary: 'Gerar termo de adoção e enviar para assinatura',
    description: 'Acesso: Termo de adoção (Editar). Ficha APROVADO ou AGUARDANDO_ASSINATURA. Exige pet vinculado e nome/CPF/e-mail do adotante. Gera nova versão (bucket privado) e já envia ao Autentique: a associação assina na hora (linha Representante legal), o adotante recebe o link por e-mail e a ficha vai para AGUARDANDO_ASSINATURA. Envio pendente da versão anterior é cancelado.',
  })
  generate(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.contractService.generate(id, req.user.organizationId, req.user.id);
  }

  @Post(':id/contract/signature/sync')
  @RequireAccess(Screen.ADOPTION_CONTRACT, AccessLevel.EDIT)
  @ApiOperation({
    summary: 'Atualizar status da assinatura',
    description: 'Acesso: Termo de adoção (Editar). Consulta o documento no Autentique: assinado → adoção CONCLUIDA (pet ADOTADO, PDF assinado salvo no bucket privado); recusado → volta para APROVADO.',
  })
  syncSignature(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.contractService.syncSignatureByForm(id, req.user.organizationId, req.user.id);
  }

  @Delete(':id/contract/signature')
  @AdminOnly()
  @ApiOperation({
    summary: 'Cancelar envio para assinatura',
    description: 'Somente equipe Admin. Ficha AGUARDANDO_ASSINATURA. Exclui o documento no Autentique e a ficha volta para APROVADO.',
  })
  cancelSignature(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.contractService.cancelSignature(id, req.user.organizationId, req.user.id);
  }
}
