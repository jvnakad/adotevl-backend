import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ILike } from 'typeorm';
import { PetService, MAX_PET_PHOTOS } from './pet.service';
import { PetStatus } from './pet.entity';
import { FindOperator } from 'typeorm';
import { createMockRepository, MockRepository, pagination } from '../testing/mock-repository';

const file = (name = 'foto.JPG', mimetype = 'image/jpeg') =>
  ({ originalname: name, mimetype, buffer: Buffer.from('img') }) as Express.Multer.File;

describe('PetService', () => {
  let petRepo: MockRepository;
  let photoRepo: MockRepository;
  let formRepo: MockRepository;
  let txPet: MockRepository;
  let txForm: MockRepository;
  let storage: { upload: jest.Mock; remove: jest.Mock };
  let service: PetService;

  beforeAll(() => jest.useFakeTimers({ now: new Date('2026-10-14T12:00:00Z'), doNotFake: ['nextTick', 'setImmediate'] }));
  afterAll(() => jest.useRealTimers());

  beforeEach(() => {
    petRepo = createMockRepository();
    photoRepo = createMockRepository();
    formRepo = createMockRepository();
    txPet = createMockRepository();
    txForm = createMockRepository();
    const manager = { getRepository: jest.fn((entity) => (entity.name === 'Pet' ? txPet : txForm)) };
    (petRepo as any).manager = { transaction: jest.fn(async (work) => work(manager)) };
    formRepo.find.mockResolvedValue([]);
    storage = { upload: jest.fn(async (path: string) => `https://cdn/${path}`), remove: jest.fn(async () => undefined) };
    service = new PetService(petRepo as any, photoRepo as any, storage as any, formRepo as any);
  });

  it('create registra auditoria e devolve fotos vazias', async () => {
    const result = await service.create({ name: 'Bob', species: 'Cachorro', sex: 'Macho', birthDate: '2024-10' }, 'org-1', 'user-1');

    expect(result).toEqual(expect.objectContaining({ name: 'Bob', organizationId: 'org-1', createdBy: 'user-1', updatedBy: 'user-1', fotos: [], ageLabel: '2 anos' }));
  });

  describe('findAll', () => {
    it('lista os cadastrados mais recentes primeiro', async () => {
      await service.findAll(pagination, { organizationId: 'org-1' });

      expect(petRepo.findAndCount).toHaveBeenCalledWith(expect.objectContaining({ order: { createdAt: 'DESC' } }));
    });

    it('devolve a idade calculada a partir do nascimento', async () => {
      petRepo.findAndCount.mockResolvedValue([[{ id: 'p1', birthDate: '2026-02', fotos: [] }, { id: 'p2', birthDate: null, fotos: [] }], 2]);

      const result = await service.findAll(pagination);

      expect(result.data.map((pet) => pet.ageLabel)).toEqual(['8 meses', null]);
    });

    it('monta filtros, converte castration e carrega fotos', async () => {
      await service.findAll(pagination, { organizationId: 'org-1', species: 'Gato', castration: 'false', status: 'ADOTADO' });

      expect(petRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isActive: true, organizationId: 'org-1', species: 'Gato', castration: false, status: 'ADOTADO' },
          relations: { fotos: true },
        }),
      );
    });

    it('busca por nome ou raça (animal) com OR, mantendo os demais filtros', async () => {
      await service.findAll(pagination, { organizationId: 'org-1', species: 'Gato', search: '  persa ' });

      const base = { isActive: true, organizationId: 'org-1', species: 'Gato' };
      expect(petRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: [
            { ...base, name: ILike('%persa%') },
            { ...base, animal: ILike('%persa%') },
          ],
        }),
      );
    });

    it('ignora busca vazia', async () => {
      await service.findAll(pagination, { organizationId: 'org-1', search: '   ' });

      expect(petRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true, organizationId: 'org-1' } }),
      );
    });

    it('ordena as fotos pela data de criação', async () => {
      const older = { id: 'f1', createdAt: new Date('2026-01-01') };
      const newer = { id: 'f2', createdAt: new Date('2026-02-01') };
      petRepo.findAndCount.mockResolvedValue([[{ id: 'p1', fotos: [newer, older] }], 1]);

      const result = await service.findAll(pagination);

      expect(result.data[0].fotos.map((f) => f.id)).toEqual(['f1', 'f2']);
    });
  });

  it('findAllPublic expõe só os campos do site, com nascimento e idade calculada', async () => {
    petRepo.findAndCount.mockResolvedValue([
      [{ id: 'p1', name: 'Bob', species: 'Cachorro', animal: 'Vira-lata', sex: 'Macho', birthDate: '2024-07', size: 'Medio', castration: true, about: 'Dócil', weight: 10, createdBy: 'u1', fotos: [{ id: 'f1', url: 'u', storagePath: 's', createdAt: new Date() }] }],
      1,
    ]);

    const result = await service.findAllPublic(pagination, { organizationId: 'org-1' });

    expect(result.data[0]).toEqual({ id: 'p1', name: 'Bob', species: 'Cachorro', animal: 'Vira-lata', sex: 'Macho', birthDate: '2024-07', ageLabel: '2 anos e 3 meses', size: 'Medio', castration: true, about: 'Dócil', fotos: [{ url: 'u' }] });
    // Ordenado por nome para o select do formulário de adoção
    expect(petRepo.findAndCount).toHaveBeenCalledWith(expect.objectContaining({ order: { name: 'ASC' } }));
  });

  it('findOne devolve a idade calculada', async () => {
    petRepo.findOne.mockResolvedValue({ id: 'p1', birthDate: '2025-09', fotos: [] });

    expect((await service.findOne('p1', 'org-1')).ageLabel).toBe('1 ano e 1 mês');
  });

  it('findOne lança NotFoundException quando não existe', async () => {
    petRepo.findOne.mockResolvedValue(null);

    await expect(service.findOne('x', 'org-1')).rejects.toThrow(NotFoundException);
    expect(petRepo.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'x', organizationId: 'org-1' } }));
  });

  it('update/remove/fotos de pet de outra organização respondem 404 sem gravar', async () => {
    petRepo.findOne.mockResolvedValue(null);

    await expect(service.update('p1', { status: PetStatus.ADOTADO } as any, 'org-A', 'u1')).rejects.toThrow(NotFoundException);
    await expect(service.remove('p1', 'org-A', 'u1')).rejects.toThrow(NotFoundException);
    await expect(service.removePhoto('p1', 'f1', 'org-A')).rejects.toThrow(NotFoundException);
    await expect(service.addPhotos('p1', [file()], 'org-A')).rejects.toThrow(NotFoundException);
    expect(petRepo.update).not.toHaveBeenCalled();
    expect(photoRepo.delete).not.toHaveBeenCalled();
  });

  describe('card do pet adotado', () => {
    it('findAll inclui adopter (ficha concluída) só nos pets ADOTADO, em uma consulta', async () => {
      petRepo.findAndCount.mockResolvedValue([[{ id: 'p1', status: PetStatus.ADOTADO, fotos: [] }, { id: 'p2', status: PetStatus.DISPONIVEL, fotos: [] }], 2]);
      formRepo.find.mockResolvedValue([{ id: 'f1', petId: 'p1', fullName: 'Maria' }]);

      const result = await service.findAll(pagination, { organizationId: 'org-1' });

      expect(result.data[0]).toEqual(expect.objectContaining({ adopter: { formId: 'f1', name: 'Maria' } }));
      expect(result.data[1]).not.toHaveProperty('adopter');
      expect(formRepo.find).toHaveBeenCalledTimes(1);
      expect(formRepo.find.mock.calls[0][0].where).toEqual(expect.objectContaining({ status: 'CONCLUIDA', isActive: true }));
      expect(formRepo.find.mock.calls[0][0].where.petId).toBeInstanceOf(FindOperator);
    });

    it('sem pet adotado não consulta fichas e a lista pública nunca traz adopter', async () => {
      petRepo.findAndCount.mockResolvedValue([[{ id: 'p2', status: PetStatus.DISPONIVEL, fotos: [] }], 1]);
      await service.findAll(pagination, { organizationId: 'org-1' });
      petRepo.findAndCount.mockResolvedValue([[{ id: 'p1', name: 'Rex', status: PetStatus.ADOTADO, fotos: [] }], 1]);
      const pub = await service.findAllPublic(pagination, { organizationId: 'org-1' });

      expect(formRepo.find).not.toHaveBeenCalled();
      expect(pub.data[0]).not.toHaveProperty('adopter');
    });

    it('findOne de pet ADOTADO devolve adopter', async () => {
      petRepo.findOne.mockResolvedValue({ id: 'p1', status: PetStatus.ADOTADO, fotos: [] });
      formRepo.find.mockResolvedValue([{ id: 'f1', petId: 'p1', fullName: 'Maria' }]);

      expect((await service.findOne('p1', 'org-1')).adopter).toEqual({ formId: 'f1', name: 'Maria' });
    });
  });

  describe('update com adoptionFormId', () => {
    const pet = (status = PetStatus.DISPONIVEL) => ({ id: 'p1', name: 'Rex', status, fotos: [] });

    it('grava os dois lados: status do pet e petId da ficha, na organização do token', async () => {
      petRepo.findOne.mockResolvedValue(pet());
      formRepo.findOne.mockResolvedValue({ id: 'f1', petId: null });

      await service.update('p1', { status: PetStatus.EM_PROCESSO, adoptionFormId: 'f1' } as any, 'org-1', 'u1');

      expect(formRepo.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'f1', organizationId: 'org-1', isActive: true } }));
      expect(txPet.update).toHaveBeenCalledWith({ id: 'p1', organizationId: 'org-1' }, { status: PetStatus.EM_PROCESSO, updatedBy: 'u1' });
      expect(txForm.update).toHaveBeenCalledWith('f1', { petId: 'p1', updatedBy: 'u1' });
    });

    it('ficha de outra organização: 404 sem gravar', async () => {
      petRepo.findOne.mockResolvedValue(pet());
      formRepo.findOne.mockResolvedValue(null);

      await expect(service.update('p1', { status: PetStatus.ADOTADO, adoptionFormId: 'f9' } as any, 'org-1')).rejects.toThrow('Ficha de adoção não encontrada.');
      expect(txPet.update).not.toHaveBeenCalled();
    });

    it('status diferente de EM_PROCESSO/ADOTADO recusa o vínculo', async () => {
      petRepo.findOne.mockResolvedValue(pet());

      await expect(service.update('p1', { status: PetStatus.DISPONIVEL, adoptionFormId: 'f1' } as any, 'org-1')).rejects.toThrow(BadRequestException);
      expect(txForm.update).not.toHaveBeenCalled();
    });

    it('pet ADOTADO por outra ficha concluída: 400 PET_ALREADY_ADOPTED', async () => {
      petRepo.findOne.mockResolvedValue(pet(PetStatus.ADOTADO));
      formRepo.findOne.mockResolvedValue({ id: 'f2', petId: null });
      formRepo.find.mockResolvedValue([{ id: 'f1', petId: 'p1', fullName: 'Maria' }]);

      const error = await service.update('p1', { status: PetStatus.ADOTADO, adoptionFormId: 'f2' } as any, 'org-1').catch((e) => e);

      expect(error.getResponse()).toEqual({ statusCode: 400, code: 'PET_ALREADY_ADOPTED', message: expect.stringContaining('já foi adotado') });
      expect(txPet.update).not.toHaveBeenCalled();
    });

    it('pet anterior da ficha volta a DISPONIVEL quando nenhuma outra ficha o segura', async () => {
      petRepo.findOne.mockResolvedValue(pet());
      formRepo.findOne.mockResolvedValue({ id: 'f1', petId: 'p-old' });
      txForm.count.mockResolvedValue(0);

      await service.update('p1', { status: PetStatus.EM_PROCESSO, adoptionFormId: 'f1' } as any, 'org-1', 'u1');

      expect(txPet.update).toHaveBeenCalledWith({ id: 'p-old', organizationId: 'org-1', status: PetStatus.EM_PROCESSO }, { status: PetStatus.DISPONIVEL, updatedBy: 'u1' });
    });
  });

  it('update ignora o campo fotos enviado pelo front', async () => {
    petRepo.findOne.mockResolvedValue({ id: 'p1', fotos: [] });

    await service.update('p1', { status: PetStatus.ADOTADO, fotos: [{ id: 'f1' }] } as any, 'org-1', 'user-2');

    expect(petRepo.update).toHaveBeenCalledWith({ id: 'p1', organizationId: 'org-1' }, { status: PetStatus.ADOTADO, updatedBy: 'user-2' });
  });

  describe('remove', () => {
    it('lança NotFoundException quando não existe', async () => {
      petRepo.findOne.mockResolvedValue(null);

      await expect(service.remove('x', 'org-1')).rejects.toThrow(NotFoundException);
    });

    it('faz soft delete', async () => {
      petRepo.findOne.mockResolvedValue({ id: 'p1' });

      await service.remove('p1', 'org-1', 'user-2');

      expect(petRepo.update).toHaveBeenCalledWith({ id: 'p1', organizationId: 'org-1' }, { isActive: false, updatedBy: 'user-2' });
    });
  });

  describe('addPhotos', () => {
    beforeEach(() => {
      petRepo.findOne.mockResolvedValue({ id: 'p1', fotos: [] });
      photoRepo.count.mockResolvedValue(0);
    });

    it('exige ao menos uma foto', async () => {
      await expect(service.addPhotos('p1', [], 'org-1')).rejects.toThrow(BadRequestException);
    });

    it('rejeita formato que não é imagem', async () => {
      await expect(service.addPhotos('p1', [file('doc.pdf', 'application/pdf')], 'org-1')).rejects.toThrow('Formato inválido');
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('lança NotFoundException para pet inexistente', async () => {
      petRepo.findOne.mockResolvedValue(null);

      await expect(service.addPhotos('p1', [file()], 'org-1')).rejects.toThrow(NotFoundException);
    });

    it(`respeita o limite de ${MAX_PET_PHOTOS} fotos`, async () => {
      photoRepo.count.mockResolvedValue(MAX_PET_PHOTOS - 1);

      await expect(service.addPhotos('p1', [file(), file()], 'org-1')).rejects.toThrow(`restam 1`);
    });

    it('envia ao storage com extensão em minúsculo e salva as fotos', async () => {
      await service.addPhotos('p1', [file('casa.JPG')], 'org-1', 'user-1');

      const [path, buffer, mimetype] = storage.upload.mock.calls[0];
      expect(path).toMatch(/^p1\/[0-9a-f-]{36}\.jpg$/);
      expect(buffer).toBeInstanceOf(Buffer);
      expect(mimetype).toBe('image/jpeg');
      expect(photoRepo.save).toHaveBeenCalledWith([{ petId: 'p1', url: `https://cdn/${path}`, storagePath: path, createdBy: 'user-1' }]);
    });

    it('remove do storage os arquivos já enviados quando algo falha', async () => {
      storage.upload.mockResolvedValueOnce('https://cdn/1').mockRejectedValueOnce(new Error('falhou'));

      await expect(service.addPhotos('p1', [file('a.jpg'), file('b.jpg')], 'org-1')).rejects.toThrow('falhou');

      expect(storage.remove).toHaveBeenCalledWith([expect.stringMatching(/^p1\//)]);
      expect(photoRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('removePhoto', () => {
    beforeEach(() => petRepo.findOne.mockResolvedValue({ id: 'p1' }));

    it('lança NotFoundException quando a foto não é do pet', async () => {
      photoRepo.findOne.mockResolvedValue(null);

      await expect(service.removePhoto('p1', 'f1', 'org-1')).rejects.toThrow('Foto não encontrada.');
    });

    it('remove do storage e do banco', async () => {
      photoRepo.findOne.mockResolvedValue({ id: 'f1', storagePath: 'p1/f1.jpg' });

      await service.removePhoto('p1', 'f1', 'org-1');

      expect(photoRepo.findOne).toHaveBeenCalledWith({ where: { id: 'f1', petId: 'p1' } });
      expect(storage.remove).toHaveBeenCalledWith(['p1/f1.jpg']);
      expect(photoRepo.delete).toHaveBeenCalledWith('f1');
    });
  });
});
