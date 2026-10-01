import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PetService, MAX_PET_PHOTOS } from './pet.service';
import { PetStatus } from './pet.entity';
import { createMockRepository, MockRepository, pagination } from '../testing/mock-repository';

const file = (name = 'foto.JPG', mimetype = 'image/jpeg') =>
  ({ originalname: name, mimetype, buffer: Buffer.from('img') }) as Express.Multer.File;

describe('PetService', () => {
  let petRepo: MockRepository;
  let photoRepo: MockRepository;
  let storage: { upload: jest.Mock; remove: jest.Mock };
  let service: PetService;

  beforeEach(() => {
    petRepo = createMockRepository();
    photoRepo = createMockRepository();
    storage = { upload: jest.fn(async (path: string) => `https://cdn/${path}`), remove: jest.fn(async () => undefined) };
    service = new PetService(petRepo as any, photoRepo as any, storage as any);
  });

  it('create registra auditoria e devolve fotos vazias', async () => {
    const result = await service.create({ name: 'Bob', species: 'Cachorro', sex: 'Macho', organizationId: 'org-1' }, 'user-1');

    expect(result).toEqual(expect.objectContaining({ name: 'Bob', createdBy: 'user-1', updatedBy: 'user-1', fotos: [] }));
  });

  describe('findAll', () => {
    it('monta filtros, converte castration e carrega fotos', async () => {
      await service.findAll(pagination, { organizationId: 'org-1', species: 'Gato', castration: 'false', status: 'ADOTADO' });

      expect(petRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isActive: true, organizationId: 'org-1', species: 'Gato', castration: false, status: 'ADOTADO' },
          relations: { fotos: true },
        }),
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

  it('findAllPublic expõe só os campos do site', async () => {
    petRepo.findAndCount.mockResolvedValue([
      [{ id: 'p1', name: 'Bob', sex: 'Macho', age: 3, size: 'Medio', castration: true, about: 'Dócil', weight: 10, createdBy: 'u1', fotos: [{ id: 'f1', url: 'u', storagePath: 's', createdAt: new Date() }] }],
      1,
    ]);

    const result = await service.findAllPublic(pagination, { organizationId: 'org-1' });

    expect(result.data[0]).toEqual({ id: 'p1', name: 'Bob', sex: 'Macho', age: 3, size: 'Medio', castration: true, about: 'Dócil', fotos: [{ url: 'u' }] });
  });

  it('findOne lança NotFoundException quando não existe', async () => {
    petRepo.findOne.mockResolvedValue(null);

    await expect(service.findOne('x')).rejects.toThrow(NotFoundException);
  });

  it('update ignora o campo fotos enviado pelo front', async () => {
    petRepo.findOne.mockResolvedValue({ id: 'p1', fotos: [] });

    await service.update('p1', { status: PetStatus.ADOTADO, fotos: [{ id: 'f1' }] } as any, 'user-2');

    expect(petRepo.update).toHaveBeenCalledWith('p1', { status: PetStatus.ADOTADO, updatedBy: 'user-2' });
  });

  describe('remove', () => {
    it('lança NotFoundException quando não existe', async () => {
      petRepo.findOne.mockResolvedValue(null);

      await expect(service.remove('x')).rejects.toThrow(NotFoundException);
    });

    it('faz soft delete', async () => {
      petRepo.findOne.mockResolvedValue({ id: 'p1' });

      await service.remove('p1', 'user-2');

      expect(petRepo.update).toHaveBeenCalledWith('p1', { isActive: false, updatedBy: 'user-2' });
    });
  });

  describe('addPhotos', () => {
    beforeEach(() => {
      petRepo.findOne.mockResolvedValue({ id: 'p1', fotos: [] });
      photoRepo.count.mockResolvedValue(0);
    });

    it('exige ao menos uma foto', async () => {
      await expect(service.addPhotos('p1', [])).rejects.toThrow(BadRequestException);
    });

    it('rejeita formato que não é imagem', async () => {
      await expect(service.addPhotos('p1', [file('doc.pdf', 'application/pdf')])).rejects.toThrow('Formato inválido');
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('lança NotFoundException para pet inexistente', async () => {
      petRepo.findOne.mockResolvedValue(null);

      await expect(service.addPhotos('p1', [file()])).rejects.toThrow(NotFoundException);
    });

    it(`respeita o limite de ${MAX_PET_PHOTOS} fotos`, async () => {
      photoRepo.count.mockResolvedValue(MAX_PET_PHOTOS - 1);

      await expect(service.addPhotos('p1', [file(), file()])).rejects.toThrow(`restam 1`);
    });

    it('envia ao storage com extensão em minúsculo e salva as fotos', async () => {
      await service.addPhotos('p1', [file('casa.JPG')], 'user-1');

      const [path, buffer, mimetype] = storage.upload.mock.calls[0];
      expect(path).toMatch(/^p1\/[0-9a-f-]{36}\.jpg$/);
      expect(buffer).toBeInstanceOf(Buffer);
      expect(mimetype).toBe('image/jpeg');
      expect(photoRepo.save).toHaveBeenCalledWith([{ petId: 'p1', url: `https://cdn/${path}`, storagePath: path, createdBy: 'user-1' }]);
    });

    it('remove do storage os arquivos já enviados quando algo falha', async () => {
      storage.upload.mockResolvedValueOnce('https://cdn/1').mockRejectedValueOnce(new Error('falhou'));

      await expect(service.addPhotos('p1', [file('a.jpg'), file('b.jpg')])).rejects.toThrow('falhou');

      expect(storage.remove).toHaveBeenCalledWith([expect.stringMatching(/^p1\//)]);
      expect(photoRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('removePhoto', () => {
    it('lança NotFoundException quando a foto não é do pet', async () => {
      photoRepo.findOne.mockResolvedValue(null);

      await expect(service.removePhoto('p1', 'f1')).rejects.toThrow('Foto não encontrada.');
    });

    it('remove do storage e do banco', async () => {
      photoRepo.findOne.mockResolvedValue({ id: 'f1', storagePath: 'p1/f1.jpg' });

      await service.removePhoto('p1', 'f1');

      expect(photoRepo.findOne).toHaveBeenCalledWith({ where: { id: 'f1', petId: 'p1' } });
      expect(storage.remove).toHaveBeenCalledWith(['p1/f1.jpg']);
      expect(photoRepo.delete).toHaveBeenCalledWith('f1');
    });
  });
});
