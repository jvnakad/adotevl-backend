import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TeamService } from './team.service';
import { TeamMembershipService } from './team-membership.service';
import { AccessLevel, Screen, ScreenPermissions } from '../access/access';

// Acesso que cada perfil legado tinha antes das equipes (ninguém perde acesso na migração)
const LEGACY_TEAMS: Record<string, { name: string; permissions: ScreenPermissions }> = {
  FINANCIAL: {
    name: 'Financeiro',
    permissions: {
      [Screen.FINANCIAL]: AccessLevel.EDIT,
      [Screen.BANK_ACCOUNTS]: AccessLevel.VIEW,
      [Screen.PARTNERS]: AccessLevel.VIEW,
      [Screen.CAMPAIGNS]: AccessLevel.VIEW,
    },
  },
  VOLUNTEER: {
    name: 'Voluntário Fixo',
    permissions: {
      [Screen.PETS]: AccessLevel.EDIT,
      [Screen.MEDICAL_RECORDS]: AccessLevel.EDIT,
      [Screen.ADOPTERS]: AccessLevel.EDIT,
      [Screen.ADOPTION_CONTRACT]: AccessLevel.EDIT,
      [Screen.ADOPTION_HISTORY]: AccessLevel.VIEW,
      [Screen.CAMPAIGNS]: AccessLevel.VIEW,
    },
  },
};

interface LegacyUser {
  id: string;
  fullName: string;
  cpf: string;
  birthDate: Date;
  organizationId: string;
  profileName: string;
  teamId: string | null;
}

/**
 * Perfis (ADMIN/FINANCIAL/VOLUNTEER) → equipes. Idempotente, roda a cada boot:
 * - usuário aprovado sem equipe entra na equipe do seu perfil (Admin, Financeiro ou Voluntário Fixo), com o acesso antigo;
 * - equipe Admin sem membros recebe todos os usuários de perfil ADMIN (ninguém fica trancado fora);
 * - por último garante as 4 equipes padrão: as que ainda faltam nascem sem acesso.
 */
@Injectable()
export class AccessMigrationService implements OnModuleInit {
  private readonly logger = new Logger(AccessMigrationService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly teams: TeamService,
    private readonly membership: TeamMembershipService,
  ) {}

  async onModuleInit() {
    const organizations: { id: string }[] = await this.dataSource.query('SELECT id FROM organizations');
    for (const { id } of organizations) await this.migrateOrganization(id);
  }

  private async migrateOrganization(organizationId: string) {
    const adminTeam = await this.teams.ensureAdminTeam(organizationId);
    const users: LegacyUser[] = await this.dataSource.query(
      `SELECT u.id, u.full_name AS "fullName", u.cpf, u.birth_date AS "birthDate", u.organization_id AS "organizationId",
              p.name AS "profileName", v.team_id AS "teamId"
         FROM users u
         JOIN profiles p ON p.id = u.profile_id
         LEFT JOIN volunteers v ON v.user_id = u.id AND v.is_active = true
        WHERE u.organization_id = $1 AND u.is_approved = true`,
      [organizationId],
    );

    let moved = 0;
    for (const user of users.filter((u) => !u.teamId)) {
      const teamId = user.profileName === 'ADMIN' ? adminTeam.id : (await this.legacyTeam(organizationId, user.profileName))?.id;
      if (!teamId) continue;
      await this.membership.assign(user, teamId, null);
      user.teamId = teamId;
      moved++;
    }

    await this.grantLegacyAccessToOldTeams(organizationId, users);

    if (!users.some((u) => u.teamId === adminTeam.id)) {
      for (const user of users.filter((u) => u.profileName === 'ADMIN')) {
        await this.membership.assign(user, adminTeam.id, null);
        moved++;
      }
    }
    // Depois da migração: as padrão que faltarem nascem sem acesso (as do perfil antigo já levaram o acesso)
    await this.teams.ensureDefaultTeams(organizationId);
    if (moved) this.logger.log(`Organização ${organizationId}: ${moved} usuário(s) colocado(s) em equipes pelo perfil antigo.`);
  }

  /** Equipes anteriores às permissões recebem o acesso antigo dos perfis dos membros (somado). */
  private async grantLegacyAccessToOldTeams(organizationId: string, users: LegacyUser[]) {
    const oldTeams: { id: string }[] = await this.dataSource.query(
      'SELECT id FROM teams WHERE organization_id = $1 AND is_admin = false AND access_configured_at IS NULL',
      [organizationId],
    );
    for (const { id } of oldTeams) {
      const profiles = new Set(users.filter((u) => u.teamId === id).map((u) => u.profileName));
      const permissions: ScreenPermissions = {};
      for (const profile of profiles) {
        for (const [screen, level] of Object.entries(LEGACY_TEAMS[profile]?.permissions ?? {})) {
          if (permissions[screen] !== AccessLevel.EDIT) permissions[screen] = level;
        }
      }
      // Marca a equipe mesmo sem membros: a partir daqui o Admin define o acesso
      await this.teams.setPermissions(id, permissions);
      this.logger.log(`Equipe ${id}: acesso dos perfis antigos (${[...profiles].join(', ') || 'sem membros'}) aplicado.`);
    }
  }

  // Equipe do perfil legado; criada com o acesso antigo só na primeira vez (depois o Admin ajusta)
  private async legacyTeam(organizationId: string, profileName: string) {
    const legacy = LEGACY_TEAMS[profileName];
    if (!legacy) return null;
    const [existing] = await this.dataSource.query('SELECT id FROM teams WHERE organization_id = $1 AND name = $2 LIMIT 1', [organizationId, legacy.name]);
    if (existing) return existing as { id: string };
    const team = await this.teams.create({ name: legacy.name, organizationId });
    await this.teams.setPermissions(team.id, legacy.permissions);
    return team;
  }
}
