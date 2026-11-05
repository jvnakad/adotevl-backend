import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Team, TeamSystemKey } from './team.entity';
import { TeamPermission } from './team-permission.entity';
import { CreateTeamDto } from './dto/create-team.dto';
import { PaginationDto } from '../common/pagination.dto';
import { paginate } from '../common/paginate.helper';
import { AccessLevel, ADMIN_PERMISSIONS, hasLevel, Screen, SCREEN_BY_KEY, SCREENS, ScreenPermissions } from '../access/access';

export const ADMIN_TEAM_NAME = 'Admin';

// Equipes padrão além da Admin: nascem sem acesso a nenhuma tela (o Admin define a matriz)
export const DEFAULT_TEAMS: { systemKey: TeamSystemKey; name: string }[] = [
  { systemKey: TeamSystemKey.FINANCIAL, name: 'Financeiro' },
  { systemKey: TeamSystemKey.FIXED_VOLUNTEER, name: 'Voluntário Fixo' },
  { systemKey: TeamSystemKey.FLOATING_VOLUNTEER, name: 'Voluntário Volante' },
  // Sempre por último: ao nascer, copia a matriz do Voluntário Fixo
  { systemKey: TeamSystemKey.MARKETING, name: 'Marketing' },
];
const ADMIN_LOCKED = 'A equipe Admin tem acesso total e não pode ser alterada.';

@Injectable()
export class TeamService {
  constructor(
    @InjectRepository(Team)
    private readonly teamRepository: Repository<Team>,
    @InjectRepository(TeamPermission)
    private readonly permissionRepository: Repository<TeamPermission>,
  ) {}

  async create(dto: CreateTeamDto, organizationId: string, createdBy: string = null) {
    const existing = await this.teamRepository.findOne({ where: { name: dto.name, organizationId } });
    if (existing) throw new ConflictException('Já existe uma equipe com este nome nesta organização.');
    // Equipe nova já nasce no sistema de permissões: começa sem acesso a nenhuma tela
    const team = this.teamRepository.create({ ...dto, organizationId, accessConfiguredAt: new Date(), createdBy, updatedBy: createdBy });
    return this.teamRepository.save(team);
  }

  async findAll(pagination: PaginationDto, organizationId?: string) {
    const where = organizationId ? { organizationId, isActive: true } : { isActive: true };
    return paginate(this.teamRepository, pagination, where, undefined, { isAdmin: 'DESC', name: 'ASC' });
  }

  /**
   * Equipe com a matriz completa de permissões (tela sem linha = Sem acesso).
   * Com organizationId (rotas autenticadas) equipe de outra organização responde 404;
   * sem ele só chamadas internas (migração de acesso).
   */
  async findOne(id: string, organizationId?: string) {
    const team = await this.teamRepository.findOne({ where: organizationId ? { id, organizationId } : { id } });
    if (!team) throw new NotFoundException('Equipe não encontrada.');
    return { ...team, permissions: await this.permissionsOf(team) };
  }

  async update(id: string, dto: Partial<CreateTeamDto>, updatedBy: string = null, organizationId?: string) {
    const team = await this.findOne(id, organizationId);
    if (team.isAdmin) throw new BadRequestException(ADMIN_LOCKED);
    if (team.systemKey && dto.name !== undefined && dto.name !== team.name) {
      throw new BadRequestException('Equipe padrão do sistema não pode ser renomeada.');
    }
    await this.teamRepository.update(id, { ...dto, updatedBy });
    return this.findOne(id, organizationId);
  }

  /** Substitui a matriz da equipe. Só a equipe Admin chama (rota @AdminOnly). */
  async setPermissions(id: string, permissions: ScreenPermissions, updatedBy: string = null, organizationId?: string) {
    const team = await this.findOne(id, organizationId);
    if (team.isAdmin) throw new BadRequestException(ADMIN_LOCKED);

    for (const screen of SCREENS) {
      const level = permissions[screen.key] ?? AccessLevel.NONE;
      if (screen.viewOnly && level === AccessLevel.EDIT) {
        throw new BadRequestException(`${screen.label} só pode ser Visualizar ou Sem acesso.`);
      }
      if (screen.adminOnly && level !== AccessLevel.NONE) {
        throw new BadRequestException(`${screen.label} é exclusiva da equipe Admin.`);
      }
      if (screen.parent && level !== AccessLevel.NONE && !hasLevel(permissions[screen.parent], AccessLevel.VIEW)) {
        throw new BadRequestException(`${screen.label} exige ao menos Visualizar em ${SCREEN_BY_KEY[screen.parent].label}.`);
      }
    }

    await this.permissionRepository.delete({ teamId: id });
    const rows = SCREENS.filter((screen) => (permissions[screen.key] ?? AccessLevel.NONE) !== AccessLevel.NONE).map((screen) => ({
      teamId: id,
      screen: screen.key,
      level: permissions[screen.key],
      updatedBy,
    }));
    if (rows.length) await this.permissionRepository.save(rows);
    await this.teamRepository.update(id, { accessConfiguredAt: new Date(), updatedBy });
    return this.findOne(id, organizationId);
  }

  /** Garante a equipe de sistema Admin da organização (uma equipe já chamada "Admin" é promovida). */
  async ensureAdminTeam(organizationId: string) {
    const current = await this.teamRepository.findOne({ where: { organizationId, isAdmin: true } });
    if (current) {
      if (!current.systemKey) await this.teamRepository.update(current.id, { systemKey: TeamSystemKey.ADMIN });
      return current;
    }

    const sameName = await this.teamRepository.findOne({ where: { organizationId, name: ADMIN_TEAM_NAME } });
    if (sameName) {
      await this.teamRepository.update(sameName.id, { isAdmin: true, isActive: true, systemKey: TeamSystemKey.ADMIN });
      return { ...sameName, isAdmin: true, isActive: true };
    }
    return this.teamRepository.save(
      this.teamRepository.create({ name: ADMIN_TEAM_NAME, organizationId, isAdmin: true, isActive: true, systemKey: TeamSystemKey.ADMIN }),
    );
  }

  /**
   * Garante as 5 equipes padrão (Admin, Financeiro, Voluntário Fixo, Voluntário Volante, Marketing).
   * Equipe já existente com o mesmo nome vira a padrão, mantendo membros e acesso; as que faltam nascem sem acesso,
   * exceto Marketing (cópia única da matriz do Voluntário Fixo + Marketing Editar).
   */
  async ensureDefaultTeams(organizationId: string) {
    const admin = await this.ensureAdminTeam(organizationId);
    for (const { systemKey, name } of DEFAULT_TEAMS) {
      if (await this.teamRepository.findOne({ where: { organizationId, systemKey } })) continue;
      const sameName = await this.teamRepository.findOne({ where: { organizationId, name } });
      if (sameName) {
        await this.teamRepository.update(sameName.id, { systemKey, isActive: true });
        if (systemKey === TeamSystemKey.MARKETING) await this.grantMarketingEditIfMissing(sameName.id);
        continue;
      }
      const created = await this.teamRepository.save(
        this.teamRepository.create({ name, organizationId, systemKey, isActive: true, accessConfiguredAt: new Date() }),
      );
      if (systemKey === TeamSystemKey.MARKETING) await this.copyFixedVolunteerAccess(created.id, organizationId);
    }
    return admin;
  }

  /** Equipe padrão da organização pela chave (cria as padrão que faltarem). */
  async systemTeam(organizationId: string, systemKey: TeamSystemKey) {
    await this.ensureDefaultTeams(organizationId);
    return this.teamRepository.findOne({ where: { organizationId, systemKey } });
  }

  /** Matriz atual do Voluntário Fixo + Marketing Editar, sem a Configuração (só Admin). Cópia única: depois as equipes são independentes. */
  private async copyFixedVolunteerAccess(teamId: string, organizationId: string) {
    const fixed = await this.teamRepository.findOne({ where: { organizationId, systemKey: TeamSystemKey.FIXED_VOLUNTEER } });
    const copied = fixed ? await this.permissionRepository.find({ where: { teamId: fixed.id } }) : [];
    const rows = copied
      .filter((row) => row.screen !== Screen.MARKETING && row.screen !== Screen.MARKETING_SETTINGS)
      .map((row) => ({ teamId, screen: row.screen, level: row.level }));
    await this.permissionRepository.save([...rows, { teamId, screen: Screen.MARKETING, level: AccessLevel.EDIT }]);
  }

  /** Equipe adotada como Marketing recebe Editar no quadro se ainda não tiver linha para ele (não rebaixa nem altera o resto). */
  private async grantMarketingEditIfMissing(teamId: string) {
    if (await this.permissionRepository.findOne({ where: { teamId, screen: Screen.MARKETING } })) return;
    await this.permissionRepository.save({ teamId, screen: Screen.MARKETING, level: AccessLevel.EDIT });
  }

  private async permissionsOf(team: Team): Promise<ScreenPermissions> {
    if (team.isAdmin) return ADMIN_PERMISSIONS;
    const rows = await this.permissionRepository.find({ where: { teamId: team.id } });
    const granted = Object.fromEntries(rows.map((row) => [row.screen, row.level]));
    return Object.fromEntries(SCREENS.map((screen) => [screen.key, granted[screen.key] ?? AccessLevel.NONE]));
  }
}
