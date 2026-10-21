import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { VolunteerScheduleService } from './volunteer-schedule.service';
import { createMockRepository, MockRepository } from '../testing/mock-repository';
import { ScheduleInstitution } from './schedule-institution.entity';
import { VolunteerShift } from './volunteer-shift.entity';
import { User } from '../user/user.entity';

// Agora: 14/10/2026 12:00 em Brasília
const NOW = new Date('2026-10-14T12:00:00-03:00');

describe('VolunteerScheduleService', () => {
  let shiftRepo: MockRepository;
  let lockRepo: MockRepository;
  let userRepo: MockRepository;
  let institutionRepo: MockRepository;
  let manager: { getRepository: jest.Mock; update: jest.Mock };
  let mail: { sendShiftConfirmationEmail: jest.Mock; sendShiftCancelledByLockEmail: jest.Mock };
  let realtime: { publish: jest.Mock };
  let service: VolunteerScheduleService;

  const volunteer = { id: 'u1', fullName: 'Isa Kaori', email: 'isa@teste.com', organizationId: 'org-1', isApproved: true, isActive: true };
  const self = { id: 'u1', canManage: false };
  const admin = { id: 'u-admin', canManage: true };
  const pucpr = { id: 'i1', organizationId: 'org-1', name: 'PUCPR', isActive: true };
  const booking = { organizationId: 'org-1', date: '2026-10-20', startTime: '09:00', endTime: '14:00' };

  beforeEach(() => {
    shiftRepo = createMockRepository();
    lockRepo = createMockRepository();
    userRepo = createMockRepository();
    institutionRepo = createMockRepository();
    institutionRepo.findOne.mockResolvedValue(pucpr);
    // A transação roda o callback com um manager que devolve os mesmos repositórios falsos
    const repos = new Map<unknown, MockRepository>([[VolunteerShift, shiftRepo], [ScheduleInstitution, institutionRepo]]);
    manager = { getRepository: jest.fn((entity) => repos.get(entity)), update: jest.fn() };
    const dataSource = { transaction: jest.fn((callback) => callback(manager)), getRepository: jest.fn((entity) => repos.get(entity)) };
    shiftRepo.find.mockResolvedValue([]);
    shiftRepo.save.mockImplementation(async (data) => ({ id: 's-new', ...data }));
    lockRepo.findOne.mockResolvedValue(null);
    lockRepo.find.mockResolvedValue([]);
    userRepo.findOne.mockResolvedValue(volunteer);
    mail = { sendShiftConfirmationEmail: jest.fn(), sendShiftCancelledByLockEmail: jest.fn() };
    realtime = { publish: jest.fn() };
    service = new VolunteerScheduleService(shiftRepo as any, lockRepo as any, userRepo as any, mail as any, dataSource as any, realtime as any);
  });

  describe('marcar', () => {
    it('grava o horário do próprio voluntário e envia a confirmação com o link de desmarcar', async () => {
      const shift = await service.book({ ...booking, notes: 'Levo ração' }, self, NOW);

      expect(shiftRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-1',
          userId: 'u1',
          date: '2026-10-20',
          startTime: '09:00',
          endTime: '14:00',
          notes: 'Levo ração',
          cancelToken: expect.stringMatching(/^[0-9a-f-]{36}$/),
          createdBy: 'u1',
        }),
      );
      expect(mail.sendShiftConfirmationEmail).toHaveBeenCalledWith('isa@teste.com', 'Isa Kaori', expect.objectContaining({ date: '2026-10-20', startTime: '09:00', endTime: '14:00', cancelToken: shift.cancelToken }));
    });

    it('sem programa: grava faculdade e curso vazios e não mexe no usuário', async () => {
      await service.book(booking, self, NOW);

      expect(shiftRepo.save).toHaveBeenCalledWith(expect.objectContaining({ institutionId: null, institutionName: null, course: null }));
      expect(manager.update).not.toHaveBeenCalled();
      expect(institutionRepo.findOne).not.toHaveBeenCalled();
    });

    it('com programa: grava faculdade, nome da época e curso (sem espaços nas pontas), guarda no usuário e põe no e-mail', async () => {
      const shift = await service.book({ ...booking, institutionId: 'i1', course: '  Direito ' }, self, NOW);

      expect(institutionRepo.findOne).toHaveBeenCalledWith({ where: { id: 'i1', organizationId: 'org-1', isActive: true } });
      expect(shiftRepo.save).toHaveBeenCalledWith(expect.objectContaining({ institutionId: 'i1', institutionName: 'PUCPR', course: 'Direito' }));
      expect(manager.update).toHaveBeenCalledWith(User, 'u1', { institutionId: 'i1', course: 'Direito' });
      expect(mail.sendShiftConfirmationEmail).toHaveBeenCalledWith('isa@teste.com', 'Isa Kaori', expect.objectContaining({ institutionName: 'PUCPR', course: 'Direito', cancelToken: shift.cancelToken }));
    });

    it('Admin marcando por outra pessoa: o programa fica guardado no voluntário do turno', async () => {
      await service.book({ ...booking, userId: 'u1', institutionId: 'i1', course: 'Direito' }, admin, NOW);

      expect(manager.update).toHaveBeenCalledWith(User, 'u1', { institutionId: 'i1', course: 'Direito' });
    });

    it('faculdade sem curso, ou curso sem faculdade, é recusado', async () => {
      const together = new BadRequestException('Informe a faculdade e o curso juntos, ou nenhum dos dois.');
      await expect(service.book({ ...booking, institutionId: 'i1' }, self, NOW)).rejects.toThrow(together);
      await expect(service.book({ ...booking, course: 'Direito' }, self, NOW)).rejects.toThrow(together);
      await expect(service.book({ ...booking, institutionId: 'i1', course: '   ' }, self, NOW)).rejects.toThrow(together);
      expect(shiftRepo.save).not.toHaveBeenCalled();
    });

    it('faculdade inativa, inexistente ou de outra organização é recusada e nada é gravado', async () => {
      institutionRepo.findOne.mockResolvedValue(null);

      await expect(service.book({ ...booking, institutionId: 'i9', course: 'Direito' }, self, NOW)).rejects.toThrow(new BadRequestException('Essa faculdade não está mais disponível, escolha outra.'));
      expect(shiftRepo.save).not.toHaveBeenCalled();
      expect(manager.update).not.toHaveBeenCalled();
      expect(mail.sendShiftConfirmationEmail).not.toHaveBeenCalled();
    });

    it('dia útil: fora das 08h–16h ou fim antes do início é recusado', async () => {
      await expect(service.book({ ...booking, startTime: '07:30' }, self, NOW)).rejects.toThrow(new BadRequestException('Neste dia, escolha um horário entre 08:00 e 16:00.'));
      await expect(service.book({ ...booking, endTime: '16:30' }, self, NOW)).rejects.toThrow(new BadRequestException('Neste dia, escolha um horário entre 08:00 e 16:00.'));
      await expect(service.book({ ...booking, startTime: '14:00', endTime: '14:00' }, self, NOW)).rejects.toThrow(new BadRequestException('O fim precisa ser depois do início.'));
      expect(shiftRepo.save).not.toHaveBeenCalled();
    });

    it('sábado e domingo: só das 13h às 16h', async () => {
      const saturday = { ...booking, date: '2026-10-24' };
      await expect(service.book({ ...saturday, startTime: '12:30', endTime: '14:00' }, self, NOW)).rejects.toThrow(new BadRequestException('Neste dia, escolha um horário entre 13:00 e 16:00.'));
      await expect(service.book({ ...booking, date: '2026-10-25', startTime: '13:00', endTime: '16:30' }, self, NOW)).rejects.toThrow(new BadRequestException('Neste dia, escolha um horário entre 13:00 e 16:00.'));
      await expect(service.book({ ...saturday, startTime: '13:00', endTime: '16:00' }, self, NOW)).resolves.toBeDefined();
    });

    it('só a partir de amanhã e até 60 dias à frente', async () => {
      await expect(service.book({ ...booking, date: '2026-10-14' }, self, NOW)).rejects.toThrow(new BadRequestException('Marque a partir de amanhã.'));
      await expect(service.book({ ...booking, date: '2026-12-14' }, self, NOW)).rejects.toThrow(new BadRequestException('Dá para marcar até 60 dias à frente.'));
      await expect(service.book({ ...booking, date: '2026-12-13', startTime: '13:00', endTime: '15:00' }, self, NOW)).resolves.toBeDefined();
    });

    it('dia trancado não aceita marcação e mostra a mensagem', async () => {
      lockRepo.findOne.mockResolvedValue({ id: 'l1', date: '2026-10-20', message: 'Mutirão de castração' });

      await expect(service.book(booking, self, NOW)).rejects.toThrow(new BadRequestException('Dia trancado: Mutirão de castração'));
    });

    it('a mesma pessoa pode marcar de novo no dia, desde que os horários não se cruzem', async () => {
      shiftRepo.find.mockResolvedValue([{ id: 's1', userId: 'u1', date: '2026-10-20', startTime: '13:00', endTime: '15:00' }]);

      await expect(service.book(booking, self, NOW)).rejects.toThrow(new ConflictException('Você já tem um horário nesse dia que cruza com este.'));
      await expect(service.book({ ...booking, startTime: '15:00', endTime: '16:00' }, self, NOW)).resolves.toBeDefined();
    });

    it('voluntário não marca por outra pessoa; quem gerencia a agenda marca', async () => {
      await expect(service.book({ ...booking, userId: 'u2' }, self, NOW)).rejects.toThrow(ForbiddenException);

      userRepo.findOne.mockResolvedValue({ ...volunteer, id: 'u2' });
      await service.book({ ...booking, userId: 'u2' }, admin, NOW);
      expect(shiftRepo.save).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u2', createdBy: 'u-admin' }));
    });

    it('voluntário inativo, pendente ou de outra organização não marca', async () => {
      userRepo.findOne.mockResolvedValue({ ...volunteer, isApproved: false });

      await expect(service.book(booking, self, NOW)).rejects.toThrow(new ForbiddenException('Só voluntários ativos marcam na agenda.'));
    });
  });

  describe('desmarcar', () => {
    const shift = { id: 's1', organizationId: 'org-1', userId: 'u1', date: '2026-10-20', startTime: '09:00', endTime: '14:00', cancelledAt: null };

    it('o próprio voluntário desmarca com mais de 24h de antecedência', async () => {
      shiftRepo.findOne.mockResolvedValue(shift);

      await service.cancel('s1', 'org-1', self, NOW);

      expect(shiftRepo.update).toHaveBeenCalledWith('s1', { cancelledAt: NOW, cancelReason: 'Desmarcado pelo voluntário', updatedBy: 'u1' });
    });

    it('faltando menos de 24h só quem gerencia a agenda desmarca', async () => {
      shiftRepo.findOne.mockResolvedValue({ ...shift, date: '2026-10-15', startTime: '10:00' });

      await expect(service.cancel('s1', 'org-1', self, NOW)).rejects.toThrow(
        new ForbiddenException('Faltam menos de 24h para o horário. Fale com a ONG pelo WhatsApp.'),
      );
      await service.cancel('s1', 'org-1', admin, NOW);
      expect(shiftRepo.update).toHaveBeenCalledWith('s1', expect.objectContaining({ cancelReason: 'Removido pela equipe' }));
    });

    it('não desmarca horário de outra pessoa', async () => {
      shiftRepo.findOne.mockResolvedValue({ ...shift, userId: 'u2' });

      await expect(service.cancel('s1', 'org-1', self, NOW)).rejects.toThrow(ForbiddenException);
    });

    it('pelo link do e-mail vale a mesma regra das 24h', async () => {
      shiftRepo.findOne.mockResolvedValueOnce(shift);
      await service.cancelByToken('token-1', NOW);
      expect(shiftRepo.update).toHaveBeenCalledWith('s1', expect.objectContaining({ cancelledAt: NOW, updatedBy: 'u1' }));

      shiftRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.cancelByToken('x', NOW)).rejects.toThrow(new NotFoundException('Horário não encontrado ou já desmarcado.'));
    });
  });

  describe('mês', () => {
    beforeEach(() => {
      shiftRepo.find.mockResolvedValue([
        { id: 's1', userId: 'u1', date: '2026-10-06', startTime: '09:00', endTime: '14:00', notes: 'Levo ração', institutionName: 'PUCPR', course: 'Direito', user: { fullName: 'Isa Kaori' } },
        { id: 's2', userId: 'u2', date: '2026-10-06', startTime: '09:00', endTime: '14:00', notes: 'Chego atrasado', institutionName: 'UFPR', course: 'Medicina', user: { fullName: 'Guilherme' } },
      ]);
      lockRepo.find.mockResolvedValue([{ id: 'l1', date: '2026-10-12', message: 'Feriado' }]);
    });

    it('equipe Admin vê os nomes', async () => {
      const result = await service.month('org-1', '2026-10', { userId: 'u-admin', isAdmin: true });

      expect(result.shifts.map((shift) => shift.name)).toEqual(['Isa Kaori', 'Guilherme']);
      expect(result.locks).toEqual([{ id: 'l1', date: '2026-10-12', message: 'Feriado' }]);
      expect(result.shifts.map((shift) => [shift.institutionName, shift.course])).toEqual([['PUCPR', 'Direito'], ['UFPR', 'Medicina']]);
    });

    it('voluntário vê "Você" nos seus e "Voluntário" nos demais, sem observação alheia', async () => {
      const result = await service.month('org-1', '2026-10', { userId: 'u1', isAdmin: false });

      expect(result.shifts).toEqual([
        { id: 's1', date: '2026-10-06', startTime: '09:00', endTime: '14:00', name: 'Você', mine: true, notes: 'Levo ração', institutionName: 'PUCPR', course: 'Direito' },
        { id: null, date: '2026-10-06', startTime: '09:00', endTime: '14:00', name: 'Voluntário', mine: false, notes: null, institutionName: null, course: null },
      ]);
    });

    it('LP sem identificação só vê "Voluntário" e o horário', async () => {
      const result = await service.month('org-1', '2026-10', { userId: null, isAdmin: false });

      expect(result.shifts.every((shift) => shift.name === 'Voluntário' && shift.id === null && shift.notes === null && shift.institutionName === null && shift.course === null)).toBe(true);
    });

    it('mês inválido é recusado', async () => {
      await expect(service.month('org-1', '2026-13', { userId: null, isAdmin: false })).rejects.toThrow(BadRequestException);
    });
  });

  describe('voluntários', () => {
    it('devolve o último programa de cada um; faculdade inativa vem só com o curso (D-10)', async () => {
      userRepo.find.mockResolvedValue([
        { id: 'u1', fullName: 'Ana', institutionId: 'i1', course: 'Direito' },
        { id: 'u2', fullName: 'Bia', institutionId: 'i-off', course: 'Medicina' },
        { id: 'u3', fullName: 'Caio', institutionId: null, course: null },
      ]);
      institutionRepo.find.mockResolvedValue([{ id: 'i1' }]);

      await expect(service.volunteers('org-1')).resolves.toEqual([
        { id: 'u1', fullName: 'Ana', institutionId: 'i1', course: 'Direito' },
        { id: 'u2', fullName: 'Bia', institutionId: null, course: 'Medicina' },
        { id: 'u3', fullName: 'Caio', institutionId: null, course: null },
      ]);
    });
  });

  describe('meu programa', () => {
    it('devolve o último programa; inativa vira só o curso; sem curso é null', async () => {
      userRepo.findOne.mockResolvedValueOnce({ id: 'u1', course: 'Direito', institution: { id: 'i1', name: 'PUCPR', isActive: true } });
      await expect(service.myProgram('u1')).resolves.toEqual({ institutionId: 'i1', institutionName: 'PUCPR', course: 'Direito' });

      userRepo.findOne.mockResolvedValueOnce({ id: 'u1', course: 'Direito', institution: { id: 'i1', name: 'PUCPR', isActive: false } });
      await expect(service.myProgram('u1')).resolves.toEqual({ institutionId: null, institutionName: null, course: 'Direito' });

      userRepo.findOne.mockResolvedValueOnce({ id: 'u1', course: null, institution: null });
      await expect(service.myProgram('u1')).resolves.toBeNull();
    });
  });

  describe('trancar dia', () => {
    it('grava a mensagem, cancela quem estava marcado e avisa por e-mail', async () => {
      shiftRepo.find.mockResolvedValue([
        { id: 's1', userId: 'u1', date: '2026-10-20', startTime: '09:00', endTime: '14:00', user: { fullName: 'Isa Kaori', email: 'isa@teste.com' } },
      ]);
      lockRepo.save.mockImplementation(async (data) => ({ id: 'l1', ...data }));

      await service.lock('org-1', '2026-10-20', 'Mutirão de castração', 'u-admin', NOW);

      expect(lockRepo.save).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org-1', date: '2026-10-20', message: 'Mutirão de castração', createdBy: 'u-admin' }));
      expect(shiftRepo.update).toHaveBeenCalledWith('s1', { cancelledAt: NOW, cancelReason: 'Dia trancado: Mutirão de castração', updatedBy: 'u-admin' });
      expect(mail.sendShiftCancelledByLockEmail).toHaveBeenCalledWith('isa@teste.com', 'Isa Kaori', expect.objectContaining({ date: '2026-10-20' }), 'Mutirão de castração');
    });

    it('dia já trancado dá conflito', async () => {
      lockRepo.findOne.mockResolvedValue({ id: 'l1' });

      await expect(service.lock('org-1', '2026-10-20', 'Outro', 'u-admin', NOW)).rejects.toThrow(new ConflictException('Esse dia já está trancado.'));
    });
  });

  describe('tempo real (schedule.changed)', () => {
    const shift = { id: 's1', organizationId: 'org-1', userId: 'u1', date: '2026-10-20', startTime: '09:00', endTime: '14:00', cancelledAt: null, cancelToken: 't1' };

    it('marcar pelo painel: shift.created com o dia e o autor', async () => {
      await service.book(booking, self, NOW);

      expect(realtime.publish).toHaveBeenCalledWith('org-1', 'shift.created', ['2026-10-20'], 'u1');
    });

    it('marcar pela LP: sem autor', async () => {
      await service.book(booking, { ...self, public: true }, NOW);

      expect(realtime.publish).toHaveBeenCalledWith('org-1', 'shift.created', ['2026-10-20'], undefined);
    });

    it('marcação recusada não emite', async () => {
      await expect(service.book({ ...booking, startTime: '07:00' }, self, NOW)).rejects.toThrow(BadRequestException);

      expect(realtime.publish).not.toHaveBeenCalled();
    });

    it('editar horário: shift.updated', async () => {
      shiftRepo.findOne.mockResolvedValue(shift);

      await service.update('s1', 'org-1', { startTime: '10:00', endTime: '12:00' }, admin, NOW);

      expect(realtime.publish).toHaveBeenCalledWith('org-1', 'shift.updated', ['2026-10-20'], 'u-admin');
    });

    it('desmarcar pelo painel e pela sessão da LP; sem permissão não emite', async () => {
      shiftRepo.findOne.mockResolvedValue(shift);
      await service.cancel('s1', 'org-1', admin, NOW);
      expect(realtime.publish).toHaveBeenLastCalledWith('org-1', 'shift.cancelled', ['2026-10-20'], 'u-admin');

      await service.cancel('s1', 'org-1', { ...self, public: true }, NOW);
      expect(realtime.publish).toHaveBeenLastCalledWith('org-1', 'shift.cancelled', ['2026-10-20'], undefined);

      realtime.publish.mockClear();
      shiftRepo.findOne.mockResolvedValue({ ...shift, userId: 'u2' });
      await expect(service.cancel('s1', 'org-1', self, NOW)).rejects.toThrow(ForbiddenException);
      expect(realtime.publish).not.toHaveBeenCalled();
    });

    it('desmarcar pelo link do e-mail: sem autor, com a organização do turno', async () => {
      shiftRepo.findOne.mockResolvedValue(shift);

      await service.cancelByToken('t1', NOW);

      expect(realtime.publish).toHaveBeenCalledWith('org-1', 'shift.cancelled', ['2026-10-20']);
    });

    it('trancar dia: shift.cancelled (se havia gente) e lock.created; sem ninguém marcado só lock.created', async () => {
      lockRepo.save.mockImplementation(async (data) => ({ id: 'l1', ...data }));
      shiftRepo.find.mockResolvedValue([{ id: 's1', date: '2026-10-20', user: { fullName: 'Isa', email: 'isa@teste.com' } }]);
      await service.lock('org-1', '2026-10-20', 'Mutirão', 'u-admin', NOW);
      expect(realtime.publish.mock.calls).toEqual([
        ['org-1', 'shift.cancelled', ['2026-10-20'], 'u-admin'],
        ['org-1', 'lock.created', ['2026-10-20'], 'u-admin'],
      ]);

      realtime.publish.mockClear();
      shiftRepo.find.mockResolvedValue([]);
      await service.lock('org-1', '2026-10-21', 'Outro', 'u-admin', NOW);
      expect(realtime.publish.mock.calls).toEqual([['org-1', 'lock.created', ['2026-10-21'], 'u-admin']]);
    });

    it('destrancar: lock.removed com o dia do bloqueio; bloqueio inexistente não emite', async () => {
      lockRepo.findOne.mockResolvedValueOnce({ id: 'l1', date: '2026-10-20' });
      await service.unlock('l1', 'org-1', 'u-admin');
      expect(realtime.publish).toHaveBeenCalledWith('org-1', 'lock.removed', ['2026-10-20'], 'u-admin');

      realtime.publish.mockClear();
      lockRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.unlock('x', 'org-1', 'u-admin')).rejects.toThrow(NotFoundException);
      expect(realtime.publish).not.toHaveBeenCalled();
    });
  });
});
