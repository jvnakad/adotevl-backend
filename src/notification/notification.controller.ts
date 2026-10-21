import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationService } from './notification.service';
import { FindNotificationsDto } from './dto/find-notifications.dto';

// Qualquer usuário logado, sempre só as próprias notificações
@ApiTags('Notificações')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar minhas notificações',
    description: 'Qualquer usuário logado. Mais recentes primeiro, paginação por cursor: { items, unreadCount, nextCursor }. Filtro: unread=true.',
  })
  findAll(@Query() query: FindNotificationsDto, @Request() req) {
    return this.notificationService.findAll(req.user.id, query);
  }

  @Post('read-all')
  @HttpCode(200)
  @ApiOperation({ summary: 'Marcar todas como lidas', description: 'Qualquer usuário logado. Só as próprias. Devolve { unreadCount } e emite notification.read.' })
  readAll(@Request() req) {
    return this.notificationService.markAllRead(req.user.id);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Marcar uma notificação como lida', description: 'Qualquer usuário logado. Devolve { unreadCount } e emite notification.read. Notificação de outro usuário responde 404.' })
  read(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.notificationService.markRead(id, req.user.id);
  }
}
