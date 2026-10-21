import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AccessLevel, hasLevel, Screen } from '../access/access';
import { AccessService } from '../access/access.service';
import { RealtimeService } from '../realtime/realtime.service';
import { currentClientId } from '../common/request-context';

export const SCHEDULE_ROOM = 'schedule';
export const scheduleRoom = (organizationId: string) => `${SCHEDULE_ROOM}:${organizationId}`;

export const SCHEDULE_CHANGED_EVENT = 'schedule.changed';

export type ScheduleChangeKind = 'shift.created' | 'shift.updated' | 'shift.cancelled' | 'lock.created' | 'lock.removed' | 'institutions.changed';

/**
 * Avisa o painel da Agenda (room `schedule:<orgId>`, Agenda Visualizar+, checado no join e a cada emissão) de que algo mudou.
 * Payload só com organização, dias e tipo (nada de nomes, cursos ou observações): o front busca de novo pela API, que aplica quem vê nomes.
 * `actor`/`clientId` só quando a ação veio do painel (LP não identifica o autor). Sempre depois do commit; falha nunca derruba a ação.
 * Contrato em docs/api/agenda-tempo-real.md.
 */
@Injectable()
export class ScheduleRealtimeService implements OnModuleInit {
  private readonly logger = new Logger(ScheduleRealtimeService.name);

  constructor(
    private readonly realtime: RealtimeService,
    private readonly access: AccessService,
  ) {}

  onModuleInit() {
    this.realtime.registerRoomType(SCHEDULE_ROOM, async (user, organizationId) => {
      if (organizationId !== user.organizationId) return false;
      const access = await this.access.forUser(user.id);
      return !!access && hasLevel(access.permissions[Screen.SCHEDULE], AccessLevel.VIEW);
    });
  }

  async publish(organizationId: string, kind: ScheduleChangeKind, dates: string[], actorId?: string) {
    try {
      const payload: Record<string, unknown> = { organizationId, dates: [...new Set(dates)].sort(), kind };
      if (actorId) {
        payload.actor = { id: actorId };
        const clientId = currentClientId();
        if (clientId) payload.clientId = clientId;
      }
      await this.realtime.emit(scheduleRoom(organizationId), SCHEDULE_CHANGED_EVENT, payload);
    } catch (error) {
      this.logger.warn(`Falha ao publicar ${SCHEDULE_CHANGED_EVENT}: ${(error as Error).message}`);
    }
  }
}
