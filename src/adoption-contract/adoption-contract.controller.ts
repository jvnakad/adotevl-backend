import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AdoptionContractService } from './adoption-contract.service';
import { UpdateAdoptionContractDto } from './dto/update-adoption-contract.dto';

// Rotas do contrato ficam sob a ficha: /adoption-forms/:id/contract
@ApiTags('Termo de adoção')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('adoption-forms')
export class AdoptionContractController {
  constructor(private readonly contractService: AdoptionContractService) {}

  @Get(':id/contract')
  @Roles('ADMIN', 'VOLUNTEER')
  @ApiOperation({
    summary: 'Buscar contrato da ficha de adoção',
    description: 'Perfis permitidos: ADMIN, VOLUNTEER. Ficha APROVADO, CONTRATO_GERADO, AGUARDANDO_ASSINATURA ou CONCLUIDA. Na primeira chamada cria o rascunho a partir do modelo, pré-preenchido com a ficha e o pet vinculado.',
  })
  findOne(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.contractService.findByForm(id, req.user.organizationId, req.user.id);
  }

  @Put(':id/contract')
  @Roles('ADMIN', 'VOLUNTEER')
  @ApiOperation({
    summary: 'Salvar rascunho do contrato',
    description: 'Perfis permitidos: ADMIN, VOLUNTEER. Body { petId?, data?, clauses? }. clauses precisa conter todas as cláusulas; a de identificação do animal não pode ser removida. Cada alteração vira um evento no histórico.',
  })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAdoptionContractDto, @Request() req) {
    return this.contractService.update(id, dto, req.user.organizationId, req.user.id);
  }

  @Post(':id/contract/clauses/:key/reset')
  @Roles('ADMIN', 'VOLUNTEER')
  @ApiOperation({ summary: 'Restaurar texto original da cláusula', description: 'Perfis permitidos: ADMIN, VOLUNTEER. Volta ao texto do modelo e reinclui a cláusula se estava removida.' })
  resetClause(@Param('id', ParseUUIDPipe) id: string, @Param('key') key: string, @Request() req) {
    return this.contractService.resetClause(id, key, req.user.organizationId, req.user.id);
  }

  @Post(':id/contract/generate')
  @Roles('ADMIN', 'VOLUNTEER')
  @ApiOperation({
    summary: 'Gerar PDF do contrato',
    description: 'Perfis permitidos: ADMIN, VOLUNTEER. Exige pet vinculado e nome/CPF do adotante. Gera nova versão (bucket privado), move a ficha APROVADO para CONTRATO_GERADO e deixa o pet EM_PROCESSO.',
  })
  generate(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.contractService.generate(id, req.user.organizationId, req.user.id);
  }

  @Post(':id/contract/signature')
  @Roles('ADMIN', 'VOLUNTEER')
  @ApiOperation({
    summary: 'Enviar contrato para assinatura (Autentique)',
    description:
      'Perfis permitidos: ADMIN, VOLUNTEER. Ficha CONTRATO_GERADO. Envia o PDF da versão atual ao Autentique; o adotante recebe o link por e-mail. Ficha vai para AGUARDANDO_ASSINATURA e o termo fica somente leitura.',
  })
  sendForSignature(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.contractService.sendForSignature(id, req.user.organizationId, req.user.id);
  }

  @Post(':id/contract/signature/sync')
  @Roles('ADMIN', 'VOLUNTEER')
  @ApiOperation({
    summary: 'Atualizar status da assinatura',
    description: 'Perfis permitidos: ADMIN, VOLUNTEER. Consulta o documento no Autentique: assinado → adoção CONCLUIDA (pet ADOTADO, PDF assinado salvo no bucket privado); recusado → volta para CONTRATO_GERADO.',
  })
  syncSignature(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.contractService.syncSignatureByForm(id, req.user.organizationId, req.user.id);
  }

  @Delete(':id/contract/signature')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Cancelar envio para assinatura',
    description: 'Perfis permitidos: ADMIN. Ficha AGUARDANDO_ASSINATURA. Exclui o documento no Autentique e a ficha volta para CONTRATO_GERADO.',
  })
  cancelSignature(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.contractService.cancelSignature(id, req.user.organizationId, req.user.id);
  }
}
