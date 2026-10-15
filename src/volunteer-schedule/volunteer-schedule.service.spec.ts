import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { VolunteerScheduleService } from './volunteer-schedule.service';
import { createMockRepository, MockRepository } from '../testing/mock-repository';

// Agora: 14/10/2026 12:00 em Brasília
const NOW = new Date('2026-10-14T12:00:00-03:00');

describe('VolunteerScheduleService', () => {
  let shiftRepo: MockRepository;
  let lockRepo: MockRepository;
  let userRepo: MockRepository;
  let mail: { sendShiftConfirmationEmail: jest.Mock; sendShiftCancelledByLockEmail: jest.Mock };
  let service: VolunteerScheduleService;

  const volunteer = { id: 'u1', fullName: 'Isa Kaori', email: 'isa@teste.com', organizationId: 'org-1', isApproved: true, isActive: true };
  const self = { id: 'u1', canManage: false };
  const admin = { id: 'u-admin', canManage: true };
  const booking = { organizationId: 'org-1', date: '2026-10-20', startTime: '09:00', endTime: '14:00' };

  beforeEach(() => {
    shiftRepo = createMockRepository();
    lockRepo = createMockRepository();
    userRepo = createMockRepository();
    shiftRepo.find.mockResolvedValue([]);
    shiftRepo.save.mockImplementation(async (data) => ({ id: 's-new', ...data }));
    lockRepo.findOne.mockResolvedValue(null);
    lockRepo.find.mockResolvedValue([]);
    userRepo.findOne.mockResolvedValue(volunteer);
    mail = { sendShiftConfirmationEmail: jest.fn(), sendShiftCancelledByLockEmail: jest.fn() };
    service = new VolunteerScheduleService(shiftRepo as any, lockRepo as any, userRepo as any, mail as any);
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
        { id: 's1', userId: 'u1', date: '2026-10-06', startTime: '09:00', endTime: '14:00', notes: 'Levo ração', user: { fullName: 'Isa Kaori' } },
        { id: 's2', userId: 'u2', date: '2026-10-06', startTime: '09:00', endTime: '14:00', notes: 'Chego atrasado', user: { fullName: 'Guilherme' } },
      ]);
      lockRepo.find.mockResolvedValue([{ id: 'l1', date: '2026-10-12', message: 'Feriado' }]);
    });

    it('equipe Admin vê os nomes', async () => {
      const result = await service.month('org-1', '2026-10', { userId: 'u-admin', isAdmin: true });

      expect(result.shifts.map((shift) => shift.name)).toEqual(['Isa Kaori', 'Guilherme']);
      expect(result.locks).toEqual([{ id: 'l1', date: '2026-10-12', message: 'Feriado' }]);
    });

    it('voluntário vê "Você" nos seus e "Voluntário" nos demais, sem observação alheia', async () => {
      const result = await service.month('org-1', '2026-10', { userId: 'u1', isAdmin: false });

      expect(result.shifts).toEqual([
        { id: 's1', date: '2026-10-06', startTime: '09:00', endTime: '14:00', name: 'Você', mine: true, notes: 'Levo ração' },
        { id: null, date: '2026-10-06', startTime: '09:00', endTime: '14:00', name: 'Voluntário', mine: false, notes: null },
      ]);
    });

    it('LP sem identificação só vê "Voluntário" e o horário', async () => {
      const result = await service.month('org-1', '2026-10', { userId: null, isAdmin: false });

      expect(result.shifts.every((shift) => shift.name === 'Voluntário' && shift.id === null && shift.notes === null)).toBe(true);
    });

    it('mês inválido é recusado', async () => {
      await expect(service.month('org-1', '2026-13', { userId: null, isAdmin: false })).rejects.toThrow(BadRequestException);
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
});
