import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ScheduleInstitutionService } from './schedule-institution.service';
import { CreateScheduleInstitutionDto, PublicCreateShiftDto } from './dto/schedule.dto';
import { createMockRepository, MockRepository } from '../testing/mock-repository';

const pgError = (code: string) => Object.assign(new Error('pg'), { driverError: { code } });

describe('ScheduleInstitutionService', () => {
  let repo: MockRepository;
  let dataSource: { query: jest.Mock; getRepository: jest.Mock };
  let service: ScheduleInstitutionService;

  beforeEach(() => {
    repo = createMockRepository();
    dataSource = { query: jest.fn().mockResolvedValue([{ seeded: new Date() }]), getRepository: jest.fn(() => repo) };
    service = new ScheduleInstitutionService(dataSource as any);
  });

  describe('seed da PUCPR', () => {
    it('roda uma vez por organização: com a marca gravada não insere nada', async () => {
      await service.ensureDefaultInstitutions('org-1');

      expect(dataSource.query).toHaveBeenCalledTimes(1);
    });

    it('sem a marca, insere a PUCPR numa consulta atômica', async () => {
      dataSource.query.mockResolvedValueOnce([{ seeded: null }]);

      await service.ensureDefaultInstitutions('org-1');

      expect(dataSource.query).toHaveBeenLastCalledWith(expect.stringContaining('ON CONFLICT (organization_id, name_normalized) DO NOTHING'), ['org-1', 'PUCPR', 'pucpr']);
    });

    it('o boot não cai se o seed falhar', async () => {
      dataSource.query.mockRejectedValue(new Error('banco fora'));

      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });
  });

  describe('lista da LP', () => {
    it('devolve só id e nome das ativas', async () => {
      repo.find.mockResolvedValue([{ id: 'i1', name: 'PUCPR', isActive: true, organizationId: 'org-1' }]);

      await expect(service.findActive('org-1')).resolves.toEqual([{ id: 'i1', name: 'PUCPR' }]);
      expect(repo.find).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'org-1', isActive: true } }));
    });
  });

  describe('criar, editar e excluir', () => {
    it('nome repetido (índice único) vira 409 em português', async () => {
      repo.save.mockRejectedValue(pgError('23505'));

      await expect(service.create({ name: 'ufpr' }, 'u1', 'org-1')).rejects.toThrow(new ConflictException('Já existe uma faculdade com esse nome.'));
    });

    it('grava o nome normalizado (sem acento e minúsculo) para a unicidade', async () => {
      repo.save.mockImplementation(async (data) => ({ id: 'i2', isActive: true, ...data }));

      await expect(service.create({ name: 'Católica' }, 'u1', 'org-1')).resolves.toEqual({ id: 'i2', name: 'Católica', isActive: true, totalShifts: 0, upcomingShifts: 0 });
      expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ nameNormalized: 'catolica', organizationId: 'org-1', createdBy: 'u1' }));
    });

    it('editar sem nome nem situação é recusado; faculdade de outra organização não existe', async () => {
      await expect(service.update('i1', {}, 'u1', 'org-1')).rejects.toThrow(BadRequestException);

      repo.findOne.mockResolvedValue(null);
      await expect(service.update('i1', { isActive: false }, 'u1', 'org-1')).rejects.toThrow(new NotFoundException('Faculdade não encontrada.'));
      expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'i1', organizationId: 'org-1' } });
    });

    it('desativar devolve os turnos futuros que a usam (aviso informativo)', async () => {
      repo.findOne.mockResolvedValue({ id: 'i1', name: 'PUCPR', nameNormalized: 'pucpr', isActive: true });
      dataSource.query.mockResolvedValue([{ id: 'i1', name: 'PUCPR', is_active: false, total_shifts: 5, upcoming_shifts: 2 }]);

      const result = await service.update('i1', { isActive: false }, 'u1', 'org-1');

      expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ isActive: false, updatedBy: 'u1' }));
      expect(result).toEqual({ id: 'i1', name: 'PUCPR', isActive: false, totalShifts: 5, upcomingShifts: 2 });
    });

    it('excluir faculdade já usada (FK RESTRICT) vira 409 mandando desativar', async () => {
      repo.delete.mockRejectedValue(pgError('23503'));

      await expect(service.remove('i1', 'org-1')).rejects.toThrow(new ConflictException('Essa faculdade já foi usada em agendamentos. Desative-a.'));
    });

    it('excluir faculdade nunca usada remove; inexistente é 404', async () => {
      repo.delete.mockResolvedValueOnce({ affected: 1 });
      await expect(service.remove('i1', 'org-1')).resolves.toEqual({ message: 'Faculdade excluída com sucesso.' });

      repo.delete.mockResolvedValueOnce({ affected: 0 });
      await expect(service.remove('i1', 'org-1')).rejects.toThrow(NotFoundException);
    });
  });
});

describe('DTOs da faculdade', () => {
  const errorsOf = async (dto: object, Type: new () => object) => (await validate(plainToInstance(Type, dto), { whitelist: true })).flatMap((error) => Object.values(error.constraints ?? {}));
  const shift = { date: '2026-10-20', startTime: '09:00', endTime: '12:00' };
  const id = '2f8f4c43-6f45-4a9e-9c3b-0f2f3b1b6a11';

  it('agendamento: faculdade e curso opcionais; curso de 2 a 120 caracteres depois do trim', async () => {
    expect(await errorsOf(shift, PublicCreateShiftDto)).toEqual([]);
    expect(await errorsOf({ ...shift, institutionId: id, course: '  Direito  ' }, PublicCreateShiftDto)).toEqual([]);
    expect(await errorsOf({ ...shift, institutionId: id, course: ' D ' }, PublicCreateShiftDto)).toEqual(['O curso precisa ter entre 2 e 120 caracteres.']);
    // Só espaços = ausente: passa no DTO e o service recusa com a mensagem do par (BUG-05)
    expect(await errorsOf({ ...shift, institutionId: id, course: '   ' }, PublicCreateShiftDto)).toEqual([]);
    expect(await errorsOf({ ...shift, institutionId: id, course: 'x'.repeat(121) }, PublicCreateShiftDto)).toEqual(['O curso precisa ter entre 2 e 120 caracteres.']);
    expect(await errorsOf({ ...shift, institutionId: 'abc', course: 'Direito' }, PublicCreateShiftDto)).toEqual(['Faculdade inválida.']);
  });

  it('nome da faculdade: obrigatório e até 80 caracteres', async () => {
    expect(await errorsOf({ name: ' PUCPR ' }, CreateScheduleInstitutionDto)).toEqual([]);
    expect(await errorsOf({ name: '   ' }, CreateScheduleInstitutionDto)).toEqual(['Informe o nome da faculdade.']);
    expect(await errorsOf({ name: 'x'.repeat(81) }, CreateScheduleInstitutionDto)).toEqual(['Use até 80 caracteres.']);
  });
});
