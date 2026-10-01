import { BadRequestException, ConflictException } from '@nestjs/common';
import { ProfileService } from './profile.service';
import { createMockRepository, MockRepository } from '../testing/mock-repository';

describe('ProfileService', () => {
  let profileRepo: MockRepository;
  let userRepo: MockRepository;
  let service: ProfileService;

  beforeEach(() => {
    profileRepo = createMockRepository();
    userRepo = createMockRepository();
    service = new ProfileService(profileRepo as any, userRepo as any);
  });

  describe('onModuleInit', () => {
    it('cria os perfis padrão que não existem', async () => {
      profileRepo.findOne.mockImplementation(async ({ where }) => (where.name === 'ADMIN' ? { id: 'p-admin' } : null));

      await service.onModuleInit();

      const saved = profileRepo.save.mock.calls.map(([p]) => p.name);
      expect(saved).toEqual(['FINANCIAL', 'VOLUNTEER']);
    });

    it('não cria nada quando todos já existem', async () => {
      profileRepo.findOne.mockResolvedValue({ id: 'p' });

      await service.onModuleInit();

      expect(profileRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('cria perfil ativo', async () => {
      profileRepo.findOne.mockResolvedValue(null);

      const result = await service.create({ name: 'GESTOR' } as any);

      expect(result).toEqual(expect.objectContaining({ name: 'GESTOR', isActive: true }));
    });

    it('lança ConflictException com nome repetido', async () => {
      profileRepo.findOne.mockResolvedValue({ id: 'p1' });

      await expect(service.create({ name: 'ADMIN' } as any)).rejects.toThrow(ConflictException);
    });
  });

  describe('remove', () => {
    it('lança BadRequestException quando o perfil não existe', async () => {
      profileRepo.findOne.mockResolvedValue(null);

      await expect(service.remove('x')).rejects.toThrow(BadRequestException);
    });

    it('lança ConflictException quando há usuários vinculados', async () => {
      profileRepo.findOne.mockResolvedValue({ id: 'p1' });
      userRepo.count.mockResolvedValue(2);

      await expect(service.remove('p1')).rejects.toThrow(ConflictException);
      expect(profileRepo.remove).not.toHaveBeenCalled();
    });

    it('remove perfil sem usuários', async () => {
      const profile = { id: 'p1' };
      profileRepo.findOne.mockResolvedValue(profile);
      userRepo.count.mockResolvedValue(0);

      await service.remove('p1');

      expect(userRepo.count).toHaveBeenCalledWith({ where: { profileId: 'p1' } });
      expect(profileRepo.remove).toHaveBeenCalledWith(profile);
    });
  });

  it('findAll, findOne e findByName delegam ao repositório', async () => {
    profileRepo.find.mockResolvedValue([{ id: 'p1' }]);

    expect(await service.findAll()).toEqual([{ id: 'p1' }]);
    await service.findOne('p1');
    await service.findByName('ADMIN');

    expect(profileRepo.findOne).toHaveBeenNthCalledWith(1, { where: { id: 'p1' } });
    expect(profileRepo.findOne).toHaveBeenNthCalledWith(2, { where: { name: 'ADMIN' } });
  });
});
