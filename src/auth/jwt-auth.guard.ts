import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { TeamSystemKey } from '../team/team.entity';

const INVALID_TOKEN = 'Token inválido ou expirado.';

// Query enxuta: o User tem profile/organization eager, e um findOne traria dois joins em toda rota autenticada.
// users."isActive" é camelCase no banco (a coluna não tem name:); volunteers e teams usam is_active
const SESSION_STATE_SQL = `
  SELECT u."isActive" AS "isActive", u.password_changed_at AS "passwordChangedAt", t.system_key AS "systemKey"
    FROM users u
    LEFT JOIN volunteers v ON v.user_id = u.id AND v.is_active = true
    LEFT JOIN teams t      ON t.id = v.team_id AND t.is_active = true
   WHERE u.id = $1`;

type SessionState = { isActive: boolean; passwordChangedAt: Date | null; systemKey: string | null };

/**
 * Sessão do painel ainda vale? Mesmas regras do guard e do websocket: sem claim scope, com sub e iat, usuário ativo,
 * fora da equipe volante e emitido a partir do segundo de password_changed_at (RN-21, RN-32).
 */
export async function isPanelSessionValid(dataSource: DataSource, payload: any): Promise<boolean> {
  if (!payload || payload.scope !== undefined || !payload.sub || typeof payload.iat !== 'number') return false;
  const [state] = (await dataSource.query(SESSION_STATE_SQL, [payload.sub])) as SessionState[];
  if (!state || !state.isActive || state.systemKey === TeamSystemKey.FLOATING_VOLUNTEER) return false;
  // Só iat menor é recusado: o token assinado no mesmo segundo da troca (RN-29) continua valendo (RN-30)
  return !(state.passwordChangedAt && payload.iat < Math.floor(new Date(state.passwordChangedAt).getTime() / 1000));
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token não fornecido.');
    }

    const token = authHeader.split(' ')[1];

    let payload: any;
    try {
      payload = this.jwtService.verify(token, { algorithms: ['HS256'] });
    } catch {
      throw new UnauthorizedException(INVALID_TOKEN);
    }

    // Token da agenda/redefinição, sessão antes da troca de senha, desativado e volante caem na hora (SEC-09, RN-21, RN-32)
    if (!(await isPanelSessionValid(this.dataSource, payload))) throw new UnauthorizedException(INVALID_TOKEN);

    request.user = {
      id: payload.sub,
      email: payload.email,
      profileId: payload.profileId,
      profileName: payload.profileName,
      organizationId: payload.organizationId,
    };
    return true;
  }
}
