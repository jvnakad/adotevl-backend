import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SCREENS } from './access';

@ApiTags('Acessos')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('access')
export class AccessController {
  @Get('screens')
  @ApiOperation({ summary: 'Telas com permissão por equipe', description: 'Qualquer usuário logado. Ordem, rótulo, tela mãe e se aceita só Visualizar.' })
  screens() {
    return SCREENS;
  }
}
