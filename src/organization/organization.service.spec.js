import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException } from '@nestjs/common';
import { OrganizationService } from './organization.service';
import { Organization } from './organization.entity';

const mockOrganization = {
  id: 'uuid-1',
  legalName: 'ONG Adote VL',
  cnpj: '12345678000190',
  description: 'Organização de adoção responsável',
  isActive: true,
  createdBy: null,
  updatedBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockRepository = {
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  find: jest.fn(),
};

describe('OrganizationService', () => {
  let service;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        OrganizationService,
        {
          provide: getRepositoryToken(Organization),
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get(OrganizationService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('deve criar uma organização com status ativo', async () => {
      mockRepository.findOne.mockResolvedValue(null);
      mockRepository.create.mockReturnValue(mockOrganization);
      mockRepository.save.mockResolvedValue(mockOrganization);

      const dto = {
        legalName: 'ONG Adote VL',
        cnpj: '12345678000190',
        description: 'Organização de adoção responsável',
      };

      const result = await service.create(dto);

      expect(result.isActive).toBe(true);
      expect(mockRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: true }),
      );
    });

    it('deve registrar createdBy e updatedBy ao criar', async () => {
      mockRepository.findOne.mockResolvedValue(null);
      mockRepository.create.mockReturnValue({ ...mockOrganization, createdBy: 'user-1', updatedBy: 'user-1' });
      mockRepository.save.mockResolvedValue({ ...mockOrganization, createdBy: 'user-1', updatedBy: 'user-1' });

      const dto = { legalName: 'ONG Adote VL', cnpj: '12345678000190' };
      const result = await service.create(dto, 'user-1');

      expect(mockRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ createdBy: 'user-1', updatedBy: 'user-1' }),
      );
    });

    it('deve lançar ConflictException quando CNPJ já estiver cadastrado', async () => {
      mockRepository.findOne.mockResolvedValue(mockOrganization);

      const dto = { legalName: 'Outra ONG', cnpj: '12345678000190' };

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
      expect(mockRepository.save).not.toHaveBeenCalled();
    });

    it('deve verificar o CNPJ antes de criar', async () => {
      mockRepository.findOne.mockResolvedValue(null);
      mockRepository.create.mockReturnValue(mockOrganization);
      mockRepository.save.mockResolvedValue(mockOrganization);

      const dto = { legalName: 'ONG Adote VL', cnpj: '12345678000190' };
      await service.create(dto);

      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { cnpj: '12345678000190' },
      });
    });
  });

  describe('findAll', () => {
    it('deve retornar todas as organizações', async () => {
      mockRepository.find.mockResolvedValue([mockOrganization]);

      const result = await service.findAll();

      expect(result).toHaveLength(1);
      expect(mockRepository.find).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('deve retornar uma organização pelo id', async () => {
      mockRepository.findOne.mockResolvedValue(mockOrganization);

      const result = await service.findOne('uuid-1');

      expect(result).toEqual(mockOrganization);
      expect(mockRepository.findOne).toHaveBeenCalledWith({ where: { id: 'uuid-1' } });
    });
  });
});
