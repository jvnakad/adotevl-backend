import { Body, Controller, Headers, HttpCode, Post, RawBodyRequest, Req } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { WebhooksService } from './webhooks.service';

// Rotas chamadas por serviços externos: sem JWT, autenticadas pela assinatura do próprio serviço
@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  // Rota pública. Cadastrar no painel do Autentique (eventos signature.accepted, signature.rejected, document.finished)
  @Post('autentique')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  autentique(@Req() req: RawBodyRequest<Request>, @Headers('x-autentique-signature') signature: string, @Body() body: any) {
    return this.webhooksService.handleAutentique(req.rawBody, signature, body);
  }
}
