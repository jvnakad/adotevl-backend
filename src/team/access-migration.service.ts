import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TeamService } from './team.service';
import { TeamMembershipService } from './team-membership.service';
import { affectedOf } from '../common/query-result';
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
 * Perfis (ADMIN/FINANCIAL/VOLUNTEER) → equipes, só na migração inicial de cada organização (RN-33, SEC-16, P-02).
 * A decisão vem da marca `organizations.access_migrated_at` e da contagem de equipes, lidas ANTES de `ensureAdminTeam`:
 * - marca preenchida: nada é atribuído por perfil;
 * - marca nula e a organização já tem alguma equipe (ativa ou inativa): ela já passou pela migração em boots anteriores ou nasceu pelo
 *   cadastro do primeiro usuário. Grava a marca sem atribuir ninguém (nem o laço por perfil nem o bloco "Admin vazia"), D-27;
 * - marca nula e nenhuma equipe: migração inicial de verdade. Roda o laço e o bloco, loga cada atribuição e grava a marca no fim;
 * - marca ilegível (erro): não atribui e loga warn.
 * Em todos os casos continuam rodando: equipe Admin, acesso antigo das equipes anteriores às permissões e as 4 equipes padrão.
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

  /** 'initial' = atribui por perfil e marca no fim; 'mark' = só marca; 'done' = nada por perfil; 'unknown' = não conseguiu ler a marca. */
  private async readMode(organizationId: string): Promise<'initial' | 'mark' | 'done' | 'unknown'> {
    try {
      const [org] = await this.dataSource.query('SELECT access_migrated_at AS "migratedAt" FROM organizations WHERE id = $1', [organizationId]);
      if (!org) return 'unknown';
      if (org.migratedAt) return 'done';
      const [{ hasTeams }] = await this.dataSource.query('SELECT EXISTS (SELECT 1 FROM teams WHERE organization_id = $1) AS "hasTeams"', [organizationId]);
      return hasTeams ? 'mark' : 'initial';
    } catch (error) {
      this.logger.warn(JSON.stringify({ event: 'access_migration.mark_unreadable', organizationId, reason: (error as Error).message }));
      return 'unknown';
    }
  }

  private async markMigrated(organizationId: string) {
    const result = await this.dataSource.query('UPDATE organizations SET access_migrated_at = now() WHERE id = $1 AND access_migrated_at IS NULL', [organizationId]);
    return affectedOf(result) > 0;
  }

  private async migrateOrganization(organizationId: string) {
    // Antes do ensureAdminTeam: ele cria a equipe Admin e mudaria a contagem de equipes
    const mode = await this.readMode(organizationId);
    if (mode === 'mark' && (await this.markMigrated(organizationId))) {
      this.logger.log(JSON.stringify({ event: 'access_migration.marked_without_assignment', organizationId }));
    }
    const assign = mode === 'initial';

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
    if (assign) {
      for (const user of users.filter((u) => !u.teamId)) {
        const teamId = user.profileName === 'ADMIN' ? adminTeam.id : (await this.legacyTeam(organizationId, user.profileName))?.id;
        if (!teamId) continue;
        await this.membership.assign(user, teamId, null);
        user.teamId = teamId;
        moved++;
        this.logAssignment(user.id, organizationId, teamId);
      }
    }

    await this.grantLegacyAccessToOldTeams(organizationId, users);

    if (assign && !users.some((u) => u.teamId === adminTeam.id)) {
      for (const user of users.filter((u) => u.profileName === 'ADMIN')) {
        await this.membership.assign(user, adminTeam.id, null);
        moved++;
        this.logAssignment(user.id, organizationId, adminTeam.id);
      }
    }
    // Depois da migração: as padrão que faltarem nascem sem acesso (as do perfil antigo já levaram o acesso)
    await this.teams.ensureDefaultTeams(organizationId);
    if (assign) await this.markMigrated(organizationId);
    if (moved) this.logger.log(`Organização ${organizationId}: ${moved} usuário(s) colocado(s) em equipes pelo perfil antigo.`);
  }

  /** Só ids: toda atribuição por perfil deixa rastro (SEC-16, M4). */
  private logAssignment(userId: string, organizationId: string, teamId: string) {
    this.logger.warn(JSON.stringify({ event: 'access_migration.assigned', userId, organizationId, teamId }));
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
    const team = await this.teams.create({ name: legacy.name }, organizationId);
    await this.teams.setPermissions(team.id, legacy.permissions);
    return team;
  }
}
