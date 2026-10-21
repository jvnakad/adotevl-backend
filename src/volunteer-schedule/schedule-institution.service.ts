import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DEFAULT_SCHEDULE_INSTITUTIONS, ScheduleInstitution } from './schedule-institution.entity';
import { CreateScheduleInstitutionDto, UpdateScheduleInstitutionDto } from './dto/schedule.dto';
import { normalizeName } from '../common/normalize-name';
import { todayInBrazil } from './schedule-time';

const NOT_FOUND_MESSAGE = 'Faculdade não encontrada.';
const DUPLICATE_MESSAGE = 'Já existe uma faculdade com esse nome.';
const IN_USE_MESSAGE = 'Essa faculdade já foi usada em agendamentos. Desative-a.';

const pgCode = (error: unknown) => (error as { driverError?: { code?: string } })?.driverError?.code;

/** Faculdades do programa de horas complementares (Configuração da Agenda, só Admin) e a lista pública da LP. */
@Injectable()
export class ScheduleInstitutionService implements OnModuleInit {
  private readonly logger = new Logger(ScheduleInstitutionService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Seed em toda organização no boot; o boot não cai se falhar (a leitura da lista tenta de novo). */
  async onModuleInit() {
    try {
      const organizations: { id: string }[] = await this.dataSource.query('SELECT id FROM organizations');
      for (const { id } of organizations) await this.ensureDefaultInstitutions(id);
    } catch (error) {
      this.logger.error(`Falha ao criar as faculdades padrão da Agenda: ${(error as Error).message}`);
    }
  }

  /**
   * Cria as faculdades padrão uma única vez por organização (marca em organizations): quem excluiu a PUCPR não a recebe de volta.
   * O UPDATE trava a linha da organização (duas instâncias não duplicam); ON CONFLICT cobre uma "PUCPR" criada à mão.
   */
  async ensureDefaultInstitutions(organizationId: string) {
    const rows: { seeded: Date | null }[] = await this.dataSource.query('SELECT schedule_institutions_seeded_at AS seeded FROM organizations WHERE id = $1', [organizationId]);
    if (!rows.length || rows[0].seeded) return;
    const values = DEFAULT_SCHEDULE_INSTITUTIONS.map((_, i) => `($${i * 2 + 2}, $${i * 2 + 3})`).join(', ');
    const params = DEFAULT_SCHEDULE_INSTITUTIONS.flatMap((name) => [name, normalizeName(name)]);
    await this.dataSource.query(
      `WITH claimed AS (
         UPDATE organizations SET schedule_institutions_seeded_at = now()
          WHERE id = $1 AND schedule_institutions_seeded_at IS NULL
         RETURNING id
       )
       INSERT INTO schedule_institutions (organization_id, name, name_normalized)
       SELECT claimed.id, v.name, v.name_normalized FROM claimed, (VALUES ${values}) AS v(name, name_normalized)
       ON CONFLICT (organization_id, name_normalized) DO NOTHING`,
      [organizationId, ...params],
    );
  }

  /** Lista da LP: só as ativas, em ordem alfabética. */
  async findActive(organizationId: string) {
    await this.ensureDefaultInstitutions(organizationId);
    const institutions = await this.dataSource.getRepository(ScheduleInstitution).find({
      where: { organizationId, isActive: true },
      order: { nameNormalized: 'ASC' },
      select: { id: true, name: true },
    });
    return institutions.map(({ id, name }) => ({ id, name }));
  }

  /** Aba Faculdades: ativas e inativas, com quantos turnos (total e futuros não cancelados) usam cada uma. */
  async findAll(organizationId: string) {
    await this.ensureDefaultInstitutions(organizationId);
    return this.withCounts(organizationId);
  }

  async create(dto: CreateScheduleInstitutionDto, userId: string, organizationId: string) {
    const repository = this.dataSource.getRepository(ScheduleInstitution);
    try {
      const saved = await repository.save(
        repository.create({ organizationId, name: dto.name, nameNormalized: normalizeName(dto.name), createdBy: userId, updatedBy: userId }),
      );
      return { id: saved.id, name: saved.name, isActive: saved.isActive, totalShifts: 0, upcomingShifts: 0 };
    } catch (error) {
      if (pgCode(error) === '23505') throw new ConflictException(DUPLICATE_MESSAGE);
      throw error;
    }
  }

  /** Renomear e/ou ativar/desativar. Turnos antigos mantêm o nome da época (snapshot). Desativar informa os turnos futuros (P-01). */
  async update(id: string, dto: UpdateScheduleInstitutionDto, userId: string, organizationId: string) {
    if (dto.name === undefined && dto.isActive === undefined) throw new BadRequestException('Informe o nome ou a situação da faculdade.');
    const repository = this.dataSource.getRepository(ScheduleInstitution);
    const institution = await repository.findOne({ where: { id, organizationId } });
    if (!institution) throw new NotFoundException(NOT_FOUND_MESSAGE);
    if (dto.name !== undefined) {
      institution.name = dto.name;
      institution.nameNormalized = normalizeName(dto.name);
    }
    if (dto.isActive !== undefined) institution.isActive = dto.isActive;
    institution.updatedBy = userId;
    try {
      await repository.save(institution);
    } catch (error) {
      if (pgCode(error) === '23505') throw new ConflictException(DUPLICATE_MESSAGE);
      throw error;
    }
    const [item] = await this.withCounts(organizationId, id);
    return item;
  }

  /** Só faculdade nunca usada em agendamento (FK RESTRICT no banco, inclusive turnos cancelados). */
  async remove(id: string, organizationId: string) {
    try {
      const { affected } = await this.dataSource.getRepository(ScheduleInstitution).delete({ id, organizationId });
      if (!affected) throw new NotFoundException(NOT_FOUND_MESSAGE);
    } catch (error) {
      if (pgCode(error) === '23503') throw new ConflictException(IN_USE_MESSAGE);
      throw error;
    }
    return { message: 'Faculdade excluída com sucesso.' };
  }

  private async withCounts(organizationId: string, id?: string, now = new Date()) {
    const rows: { id: string; name: string; is_active: boolean; total_shifts: number; upcoming_shifts: number }[] = await this.dataSource.query(
      `SELECT i.id, i.name, i.is_active,
              count(s.id)::int AS total_shifts,
              count(s.id) FILTER (WHERE s.cancelled_at IS NULL AND s.date >= $2::date)::int AS upcoming_shifts
         FROM schedule_institutions i
         LEFT JOIN volunteer_shifts s ON s.institution_id = i.id
        WHERE i.organization_id = $1 AND ($3::uuid IS NULL OR i.id = $3::uuid)
        GROUP BY i.id
        ORDER BY i.is_active DESC, i.name`,
      [organizationId, todayInBrazil(now), id ?? null],
    );
    return rows.map((row) => ({ id: row.id, name: row.name, isActive: row.is_active, totalShifts: row.total_shifts, upcomingShifts: row.upcoming_shifts }));
  }
}
