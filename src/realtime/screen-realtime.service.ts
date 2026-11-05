import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AccessLevel, hasLevel, Screen } from '../access/access';
import { AccessService } from '../access/access.service';
import { currentClientId } from '../common/request-context';
import { RealtimeService } from './realtime.service';

export const SCREEN_ROOM = 'screen';
/** Room de uma tela da organização: `screen:<SCREEN>:<organizationId>` (ex.: `screen:PETS:<orgId>`). */
export const screenRoom = (screen: Screen, organizationId: string) => `${SCREEN_ROOM}:${screen}:${organizationId}`;

export const SCREEN_CHANGED_EVENT = 'screen.changed';

export type ScreenChangeKind = 'created' | 'updated' | 'deleted';

/**
 * Telas com aviso genérico de mudança. Marketing e Agenda têm rooms e eventos próprios;
 * Financeiro fica de fora enquanto o módulo está pendente.
 */
export const REALTIME_SCREENS: Screen[] = [
  Screen.PETS,
  Screen.MEDICAL_RECORDS,
  Screen.ADOPTERS,
  Screen.ADOPTION_CONTRACT,
  Screen.ADOPTION_HISTORY,
  Screen.CAMPAIGNS,
  Screen.PARTNERS,
  Screen.VOLUNTEERS,
  Screen.TEAMS,
  Screen.BANK_ACCOUNTS,
  Screen.STOCK,
  Screen.STOCK_PRODUCT_TYPES,
  Screen.STOCK_HISTORY,
];

export interface ScreenChange {
  /** Telas afetadas: cada uma recebe o aviso na própria room (ex.: pet adotado = Pets e Adotantes). */
  screens: Screen | Screen[];
  organizationId: string;
  /** Recurso que mudou, em inglês (`pet`, `adoption-form`, `stock-product`...). */
  resource: string;
  kind: ScreenChangeKind;
  /** Id do recurso, quando houver. */
  id?: string;
  /** Usuário que fez a ação (ausente em formulário público, webhook e jobs). */
  actorId?: string | null;
}

/**
 * Aviso genérico "algo mudou nesta tela" para os módulos sem tempo real próprio (padrão da Agenda).
 * O cliente entra em `screen:<SCREEN>:<orgId>` com `room:join` (Visualizar na tela, checado no join e a cada emissão)
 * e, ao receber `screen.changed`, busca de novo pela API. Payload só com ids e tipo: nada de nomes ou dados pessoais.
 * `clientId` ecoa o X-Client-Id da requisição para a aba que fez a ação ignorar o próprio eco.
 * Chamado depois do commit; falha de tempo real nunca derruba a ação.
 */
@Injectable()
export class ScreenRealtimeService implements OnModuleInit {
  private readonly logger = new Logger(ScreenRealtimeService.name);

  constructor(
    private readonly realtime: RealtimeService,
    private readonly access: AccessService,
  ) {}

  onModuleInit() {
    // Id da room = `<SCREEN>:<orgId>` (o RealtimeService separa só o primeiro ':')
    this.realtime.registerRoomType(SCREEN_ROOM, async (user, roomId) => {
      const separator = roomId.indexOf(':');
      if (separator <= 0) return false;
      const screen = roomId.slice(0, separator) as Screen;
      const organizationId = roomId.slice(separator + 1);
      if (!REALTIME_SCREENS.includes(screen) || organizationId !== user.organizationId) return false;
      const access = await this.access.forUser(user.id);
      return !!access && hasLevel(access.permissions[screen], AccessLevel.VIEW);
    });
  }

  async publish(change: ScreenChange): Promise<void> {
    if (!change.organizationId) return;
    const screens = [...new Set(Array.isArray(change.screens) ? change.screens : [change.screens])];
    try {
      const base: Record<string, unknown> = {
        organizationId: change.organizationId,
        resource: change.resource,
        kind: change.kind,
        at: new Date().toISOString(),
      };
      if (change.id) base.id = change.id;
      if (change.actorId) {
        base.actor = { id: change.actorId };
        const clientId = currentClientId();
        if (clientId) base.clientId = clientId;
      }
      await Promise.all(
        screens.map((screen) => this.realtime.emit(screenRoom(screen, change.organizationId), SCREEN_CHANGED_EVENT, { ...base, screen })),
      );
    } catch (error) {
      this.logger.warn(`Falha ao publicar ${SCREEN_CHANGED_EVENT} (${change.resource}): ${(error as Error).message}`);
    }
  }
}
