import { NotFoundException } from '@nestjs/common';
import { MedicalRecordService } from './medical-record.service';
import { MedicalRecordType } from './medical-record.entity';
import { createMockRepository, MockRepository, pagination } from '../testing/mock-repository';

describe('MedicalRecordService', () => {
  let repo: MockRepository;
  let service: MedicalRecordService;

  beforeEach(() => {
    repo = createMockRepository();
    service = new MedicalRecordService(repo as any);
  });

  it('create registra auditoria', async () => {
    const dto = { petId: 'p1', date: '2026-01-01', type: MedicalRecordType.VACINA, description: 'V10' } as any;

    const result = await service.create(dto, 'user-1');

    expect(result).toEqual(expect.objectContaining({ ...dto, createdBy: 'user-1', updatedBy: 'user-1' }));
  });

  it('findByPet lista só registros ativos do pet', async () => {
    await service.findByPet('p1', pagination);

    expect(repo.findAndCount).toHaveBeenCalledWith(expect.objectContaining({ where: { petId: 'p1', isActive: true } }));
  });

  it('findOne lança NotFoundException quando não existe', async () => {
    repo.findOne.mockResolvedValue(null);

    await expect(service.findOne('x')).rejects.toThrow(NotFoundException);
  });

  describe('update', () => {
    it('lança NotFoundException e não grava quando não existe', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.update('x', { description: 'a' })).rejects.toThrow(NotFoundException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('grava com updatedBy e devolve o registro', async () => {
      repo.findOne.mockResolvedValueOnce({ id: 'r1' }).mockResolvedValueOnce({ id: 'r1', description: 'Reforço' });

      const result = await service.update('r1', { description: 'Reforço' }, 'user-2');

      expect(repo.update).toHaveBeenCalledWith('r1', { description: 'Reforço', updatedBy: 'user-2' });
      expect(result.description).toBe('Reforço');
    });
  });
});
