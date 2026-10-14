import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ILike } from 'typeorm';
import { ScheduleAccessService } from './schedule-access.service';
import { createMockRepository, MockRepository } from '../testing/mock-repository';

jest.mock('bcryptjs', () => ({
  hash: jest.fn(async (value: string) => `hashed:${value}`),
  compare: jest.fn(async (value: string, hash: string) => hash === `hashed:${value}`),
}));

const NOW = new Date('2026-10-14T12:00:00-03:00');
const minutesLater = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

describe('ScheduleAccessService', () => {
  let codeRepo: MockRepository;
  let userRepo: MockRepository;
  let mail: { sendScheduleCodeEmail: jest.Mock };
  let jwt: { sign: jest.Mock; verify: jest.Mock };
  let service: ScheduleAccessService;

  const volunteer = { id: 'u1', fullName: 'Isa Kaori', email: 'isa@teste.com', organizationId: 'org-1', isApproved: true, isActive: true };

  beforeEach(() => {
    codeRepo = createMockRepository();
    userRepo = createMockRepository();
    codeRepo.save.mockImplementation(async (data) => ({ id: 'c1', ...data }));
    userRepo.findOne.mockResolvedValue(volunteer);
    mail = { sendScheduleCodeEmail: jest.fn() };
    jwt = { sign: jest.fn(() => 'session-token'), verify: jest.fn() };
    service = new ScheduleAccessService(codeRepo as any, userRepo as any, mail as any, jwt as any);
  });

  describe('pedir código', () => {
    it('voluntário ativo recebe um código de 6 dígitos que vale 10 minutos', async () => {
      const result = await service.requestCode(' ISA@teste.com ', 'org-1', NOW);

      expect(userRepo.findOne).toHaveBeenCalledWith({ where: { email: ILike('ISA@teste.com'), organizationId: 'org-1' } });
      const [, , code] = mail.sendScheduleCodeEmail.mock.calls[0];
      expect(code).toMatch(/^\d{6}$/);
      expect(codeRepo.save).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', codeHash: `hashed:${code}`, expiresAt: minutesLater(10), attempts: 0 }));
      expect(result).toEqual({ status: 'SENT', message: 'Enviamos um código para o seu e-mail.' });
    });

    it('email sem cadastro avisa que é preciso ser voluntário, sem envio', async () => {
      userRepo.findOne.mockResolvedValueOnce(null);

      expect(await service.requestCode('ninguem@teste.com', 'org-1', NOW)).toEqual({
        status: 'NOT_VOLUNTEER',
        message: 'Para marcar na agenda é preciso ser voluntário.',
      });
      expect(mail.sendScheduleCodeEmail).not.toHaveBeenCalled();
      expect(codeRepo.save).not.toHaveBeenCalled();
    });

    it('cadastro aguardando aprovação ou inativo avisa que está em análise, sem envio', async () => {
      const pending = { status: 'PENDING', message: 'Seu cadastro ainda está em análise. Assim que for aprovado, você pode marcar.' };

      userRepo.findOne.mockResolvedValueOnce({ ...volunteer, isApproved: false });
      expect(await service.requestCode('isa@teste.com', 'org-1', NOW)).toEqual(pending);
      userRepo.findOne.mockResolvedValueOnce({ ...volunteer, isActive: false });
      expect(await service.requestCode('isa@teste.com', 'org-1', NOW)).toEqual(pending);

      expect(mail.sendScheduleCodeEmail).not.toHaveBeenCalled();
      expect(codeRepo.save).not.toHaveBeenCalled();
    });

    it('pedir de novo invalida os códigos anteriores', async () => {
      await service.requestCode('isa@teste.com', 'org-1', NOW);

      expect(codeRepo.update).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }), { usedAt: NOW });
    });
  });

  describe('validar código', () => {
    const stored = (overrides = {}) => ({ id: 'c1', userId: 'u1', codeHash: 'hashed:482913', expiresAt: minutesLater(10), attempts: 0, usedAt: null, ...overrides });

    it('código certo abre uma sessão de 2h da agenda', async () => {
      codeRepo.findOne.mockResolvedValue(stored());

      const result = await service.verify('isa@teste.com', '482913', 'org-1', NOW);

      expect(jwt.sign).toHaveBeenCalledWith({ sub: 'u1', organizationId: 'org-1', scope: 'schedule' }, expect.objectContaining({ expiresIn: '2h', secret: expect.stringContaining(':schedule') }));
      expect(codeRepo.update).toHaveBeenCalledWith('c1', { usedAt: NOW });
      expect(result).toEqual({ token: 'session-token', firstName: 'Isa' });
    });

    it('código errado soma tentativa', async () => {
      codeRepo.findOne.mockResolvedValue(stored({ attempts: 2 }));

      await expect(service.verify('isa@teste.com', '000000', 'org-1', NOW)).rejects.toThrow(new BadRequestException('Código incorreto.'));
      expect(codeRepo.update).toHaveBeenCalledWith('c1', { attempts: 3 });
    });

    it('depois de 5 tentativas ou de 10 minutos é preciso pedir outro', async () => {
      codeRepo.findOne.mockResolvedValueOnce(stored({ attempts: 5 }));
      await expect(service.verify('isa@teste.com', '482913', 'org-1', NOW)).rejects.toThrow(new BadRequestException('Muitas tentativas. Peça um novo código.'));

      codeRepo.findOne.mockResolvedValueOnce(stored());
      await expect(service.verify('isa@teste.com', '482913', 'org-1', minutesLater(11))).rejects.toThrow(new BadRequestException('Código expirado. Peça um novo.'));

      codeRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.verify('isa@teste.com', '482913', 'org-1', NOW)).rejects.toThrow(new BadRequestException('Código expirado. Peça um novo.'));
    });
  });

  describe('sessão', () => {
    it('token da agenda vira o voluntário', () => {
      jwt.verify.mockReturnValue({ sub: 'u1', organizationId: 'org-1', scope: 'schedule' });

      expect(service.session('Bearer session-token')).toEqual({ userId: 'u1', organizationId: 'org-1' });
      expect(jwt.verify).toHaveBeenCalledWith('session-token', expect.objectContaining({ secret: expect.stringContaining(':schedule') }));
    });

    it('token inválido, vencido ou de outro escopo é recusado', () => {
      jwt.verify.mockImplementationOnce(() => {
        throw new Error('jwt expired');
      });
      expect(() => service.session('Bearer x')).toThrow(new UnauthorizedException('Sessão da agenda expirada. Peça um novo código.'));

      jwt.verify.mockReturnValueOnce({ sub: 'u1', organizationId: 'org-1' });
      expect(() => service.session('Bearer x')).toThrow(UnauthorizedException);
      expect(() => service.session(undefined)).toThrow(UnauthorizedException);
    });
  });
});
