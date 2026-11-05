import { SetMetadata } from '@nestjs/common';
import { AccessLevel, Screen } from './access';

export const ACCESS_KEY = 'access';
export const ADMIN_ONLY_KEY = 'adminOnly';

export interface RequiredAccess {
  screen: Screen;
  level: AccessLevel;
}

/** Exige o nível na tela para a equipe do usuário (Admin passa sempre). Use com JwtAuthGuard + AccessGuard. */
export const RequireAccess = (screen: Screen, level: AccessLevel) => SetMetadata(ACCESS_KEY, { screen, level } as RequiredAccess);

/** Ação restrita à equipe Admin (remover ficha, cancelar assinatura, aprovar voluntário...). */
export const AdminOnly = () => SetMetadata(ADMIN_ONLY_KEY, true);
