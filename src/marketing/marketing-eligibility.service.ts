import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AccessLevel, Screen } from '../access/access';
import { normalizeName } from '../common/normalize-name';

export interface EligibleMember {
  id: string;
  name: string;
}

/**
 * Quem pode ser membro de card, responsável por subtarefa ou mencionado (D-09): usuário ativo da organização, em equipe ativa
 * com Editar em MARKETING (equipe Marketing ou qualquer outra com esse nível) ou na equipe Admin (Editar em tudo).
 * Quem perde o Editar continua nos cards antigos, mas deixa de aparecer aqui e não pode ser readicionado.
 */
@Injectable()
export class MarketingEligibilityService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Elegíveis da organização, A→Z. */
  async findEligible(organizationId: string, manager?: EntityManager): Promise<EligibleMember[]> {
    return this.query(organizationId, null, manager);
  }

  /** Dos ids informados, só os elegíveis (com o nome atual). Id de outra organização ou sem Editar fica de fora. */
  async filterEligible(organizationId: string, userIds: string[], manager?: EntityManager): Promise<EligibleMember[]> {
    if (!userIds.length) return [];
    return this.query(organizationId, userIds, manager);
  }

  private async query(organizationId: string, userIds: string[] | null, manager?: EntityManager) {
    const runner = manager ?? this.dataSource;
    const rows: { id: string; name: string }[] = await runner.query(
      `SELECT DISTINCT u.id, u.full_name AS name
         FROM users u
         JOIN volunteers v ON v.user_id = u.id AND v.is_active = true
         JOIN teams t ON t.id = v.team_id AND t.is_active = true
         LEFT JOIN team_permissions p ON p.team_id = t.id AND p.screen = $2 AND p.level = $3
        WHERE u.organization_id = $1
          AND u."isActive" = true
          AND (t.is_admin = true OR p.id IS NOT NULL)
          ${userIds ? 'AND u.id = ANY($4::uuid[])' : ''}`,
      userIds ? [organizationId, Screen.MARKETING, AccessLevel.EDIT, userIds] : [organizationId, Screen.MARKETING, AccessLevel.EDIT],
    );
    return rows.sort((a, b) => normalizeName(a.name).localeCompare(normalizeName(b.name)) || a.id.localeCompare(b.id));
  }
}
