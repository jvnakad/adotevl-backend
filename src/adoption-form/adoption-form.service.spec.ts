import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FindOperator } from 'typeorm';
import { AdoptionFormService, MAX_ADOPTION_FORM_PHOTOS } from './adoption-form.service';
import { AdoptionFormStatus } from './adoption-form.entity';
import { createMockRepository, MockRepository, pagination } from '../testing/mock-repository';

const file = (name = 'casa.PNG', mimetype = 'image/png') =>
  ({ originalname: name, mimetype, buffer: Buffer.from('img') }) as Express.Multer.File;

// Ficha valida sem respostas condicionais ativas (como o front envia, ja convertida pelo DTO)
const baseDto = () =>
  ({
    fullName: 'Maria',
    email: 'maria@teste.com',
    birthDate: '1990-05-10',
    cpf: '52998224725',
    phone: '11987654321',
    phoneIsWhatsapp: true,
    occupation: 'Designer',
    zipCode: '01310100',
    street: 'Av Paulista',
    number: '1000',
    neighborhood: 'Bela Vista',
    city: 'São Paulo',
    state: 'sp',
    hasPets: 'no',
    petsCount: 0,
    knowsNeuteringImportance: 'yes',
    petsVaccinesUpToDate: 'no_pets',
    catFivFelvTested: 'no_cat',
    awareOfAdaptationPeriod: 'yes',
    desiredAnimal: 'Gato',
    sawAdOn: 'instagram',
    canAffordCare: 'yes',
    intendedFood: 'Premium',
    hasTrustedClinic: 'no',
    residenceType: 'house',
    windowsScreened: 'not_adopting_cat',
    housingOwnership: 'owned',
    adultsCount: 2,
    childrenCount: 0,
    everyoneAgrees: 'yes',
    disagreementPlan: 'Conversar',
    hoursAlonePerDay: 4,
    caretakerWhenTraveling: 'Mãe',
    pregnancyOpinion: 'Fica',
    plansToMove: 'no',
    someoneAllergic: 'no',
    allergyPlan: 'Tratar',
    hasSurrenderedPet: 'no',
    hasLostPetOutside: 'no',
    hadRecentPetDeath: 'no',
    awareOfLongevity: 'yes',
    willReportChanges: 'yes',
    willNotRehomeWithoutNotice: 'yes',
    idealAnimal: 'Calmo',
    thinkingSince: '1 ano',
    awareOfEvaluationProcess: 'yes',
    agreesWithTerms: 'agree',
    declaresTruthful: 'yes',
    organizationId: 'org-1',
  }) as any;

describe('AdoptionFormService', () => {
  let formRepo: MockRepository;
  let photoRepo: MockRepository;
  let orgRepo: MockRepository;
  let storage: { upload: jest.Mock; remove: jest.Mock };
  let service: AdoptionFormService;

  beforeEach(() => {
    formRepo = createMockRepository();
    photoRepo = createMockRepository();
    orgRepo = createMockRepository();
    storage = { upload: jest.fn(async (path: string) => `https://cdn/${path}`), remove: jest.fn(async () => undefined) };
    service = new AdoptionFormService(formRepo as any, photoRepo as any, orgRepo as any, storage as any);

    orgRepo.findOne.mockResolvedValue({ id: 'org-1' });
    formRepo.save.mockImplementation(async (data) => ({ id: 'form-1', status: AdoptionFormStatus.PENDENTE, createdAt: new Date('2026-09-30'), ...data }));
  });

  const savedForm = () => formRepo.save.mock.calls[0][0];

  describe('create', () => {
    it('exige ao menos uma foto da residência', async () => {
      await expect(service.create(baseDto(), [])).rejects.toThrow('Envie pelo menos uma foto');
      expect(formRepo.save).not.toHaveBeenCalled();
    });

    it('rejeita arquivos que não são imagem', async () => {
      await expect(service.create(baseDto(), [file('a.pdf', 'application/pdf')])).rejects.toThrow('Formato inválido');
    });

    it('rejeita organização inexistente ou inativa', async () => {
      orgRepo.findOne.mockResolvedValue(null);

      await expect(service.create(baseDto(), [file()])).rejects.toThrow('Organização não encontrada.');
      expect(orgRepo.findOne).toHaveBeenCalledWith({ where: { id: 'org-1', isActive: true } });
    });

    it('salva a ficha, envia as fotos e devolve só a confirmação', async () => {
      const result = await service.create(baseDto(), [file('sala.PNG'), file('quarto.png')]);

      expect(savedForm()).toEqual(expect.objectContaining({ fullName: 'Maria', state: 'SP', birthDate: new Date('1990-05-10') }));
      expect(storage.upload).toHaveBeenCalledTimes(2);
      expect(storage.upload.mock.calls[0][0]).toMatch(/^adoption-forms\/form-1\/[0-9a-f-]{36}\.png$/);
      expect(photoRepo.save).toHaveBeenCalledWith([
        expect.objectContaining({ adoptionFormId: 'form-1', createdBy: null }),
        expect.objectContaining({ adoptionFormId: 'form-1', createdBy: null }),
      ]);
      expect(result).toEqual({ id: 'form-1', status: 'PENDENTE', createdAt: new Date('2026-09-30'), message: 'Ficha de adoção enviada com sucesso.' });
      expect(result).not.toHaveProperty('cpf');
    });

    it('apaga a ficha e os arquivos enviados quando o upload falha', async () => {
      storage.upload.mockResolvedValueOnce('https://cdn/1').mockRejectedValueOnce(new Error('storage fora'));

      await expect(service.create(baseDto(), [file(), file()])).rejects.toThrow('storage fora');

      expect(storage.remove).toHaveBeenCalledWith([expect.stringMatching(/^adoption-forms\/form-1\//)]);
      expect(formRepo.delete).toHaveBeenCalledWith('form-1');
    });

    describe('respostas condicionais', () => {
      it('sem animais: zera quantidade e força valores neutros', async () => {
        await service.create({ ...baseDto(), petsCount: 3, petsVaccinesUpToDate: 'all_up_to_date', catFivFelvTested: 'yes', petsDescription: 'sobrou' }, [file()]);

        expect(savedForm()).toEqual(
          expect.objectContaining({ petsCount: 0, petsVaccinesUpToDate: 'no_pets', catFivFelvTested: 'no_cat', petsDescription: null }),
        );
      });

      it('com animais: exige quantidade, descrição e castração', async () => {
        const promise = service.create({ ...baseDto(), hasPets: 'yes', petsCount: 0 }, [file()]);

        await expect(promise).rejects.toThrow(BadRequestException);
        await promise.catch((error) =>
          expect(error.getResponse().message).toEqual([
            'Informe quantos animais você tem.',
            'Descreva quais animais você tem.',
            'Informe se seus animais são castrados.',
          ]),
        );
        expect(formRepo.save).not.toHaveBeenCalled();
      });

      it('com animais não castrados: exige o motivo', async () => {
        const dto = { ...baseDto(), hasPets: 'yes', petsCount: 2, petsDescription: '2 gatos', petsNeutered: 'no' };

        await expect(service.create(dto, [file()])).rejects.toThrow(BadRequestException);
        await expect(service.create({ ...dto, petsNotNeuteredReason: 'Filhotes' }, [file()])).resolves.toBeDefined();
      });

      it.each([
        ['sawAdOn = other', { sawAdOn: 'other' }, 'sawAdOnOther'],
        ['clínica de confiança', { hasTrustedClinic: 'yes' }, 'trustedClinicName'],
        ['apartamento', { residenceType: 'apartment' }, 'condoPetPolicy'],
        ['outro tipo de imóvel', { housingOwnership: 'other' }, 'housingOwnershipOther'],
        ['crianças na casa', { childrenCount: 2 }, 'childrenAges'],
        ['pretende se mudar', { plansToMove: 'maybe' }, 'moveAnimalPlan'],
        ['já doou animal', { hasSurrenderedPet: 'yes' }, 'surrenderDetails'],
        ['já perdeu animal', { hasLostPetOutside: 'yes' }, 'lostPetDetails'],
        ['morte recente', { hadRecentPetDeath: 'yes' }, 'recentDeathDetails'],
      ])('exige complemento quando %s', async (_label, trigger, field) => {
        await expect(service.create({ ...baseDto(), ...trigger }, [file()])).rejects.toThrow(BadRequestException);
        await expect(service.create({ ...baseDto(), ...trigger, [field]: 'detalhe' }, [file()])).resolves.toBeDefined();
      });

      it('limpa complementos de perguntas que não se aplicam', async () => {
        await service.create({ ...baseDto(), trustedClinicName: 'Vet', condoPetPolicy: 'Permite', moveAnimalPlan: 'Levo' }, [file()]);

        expect(savedForm()).toEqual(expect.objectContaining({ trustedClinicName: null, condoPetPolicy: null, moveAnimalPlan: null }));
      });
    });
  });

  describe('findAll', () => {
    it('lista fichas ativas da organização, mais recentes primeiro', async () => {
      await service.findAll(pagination, 'org-1');

      expect(formRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: 'org-1', isActive: true }, relations: { fotos: true }, order: { createdAt: 'DESC' } }),
      );
    });

    it('filtra por status', async () => {
      await service.findAll(pagination, 'org-1', { status: 'APROVADO' });

      expect(formRepo.findAndCount.mock.calls[0][0].where).toEqual({ organizationId: 'org-1', isActive: true, status: 'APROVADO' });
    });

    it('busca por nome, email ou CPF (só dígitos) com OR', async () => {
      await service.findAll(pagination, 'org-1', { search: ' 529.982 ' });

      const where = formRepo.findAndCount.mock.calls[0][0].where;
      expect(where).toHaveLength(3);
      expect(where.map((w) => Object.keys(w).find((k) => w[k] instanceof FindOperator))).toEqual(['fullName', 'email', 'cpf']);
      expect(where[0].fullName.value).toBe('%529.982%');
      expect(where[2].cpf.value).toBe('%529982%');
      where.forEach((w) => expect(w).toEqual(expect.objectContaining({ organizationId: 'org-1', isActive: true })));
    });

    it('ordena as fotos de cada ficha', async () => {
      formRepo.findAndCount.mockResolvedValue([[{ id: 'f', fotos: [{ id: 'b', createdAt: new Date(2) }, { id: 'a', createdAt: new Date(1) }] }], 1]);

      const result = await service.findAll(pagination, 'org-1');

      expect(result.data[0].fotos.map((f) => f.id)).toEqual(['a', 'b']);
    });
  });

  describe('findOne', () => {
    it('busca só dentro da organização do usuário', async () => {
      formRepo.findOne.mockResolvedValue({ id: 'form-1', fotos: [] });

      await service.findOne('form-1', 'org-1');

      expect(formRepo.findOne).toHaveBeenCalledWith({ where: { id: 'form-1', organizationId: 'org-1', isActive: true }, relations: { fotos: true } });
    });

    it('lança NotFoundException para ficha de outra organização ou removida', async () => {
      formRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('form-1', 'org-2')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    const existing = () => ({ ...baseDto(), id: 'form-1', birthDate: new Date('1990-05-10'), state: 'SP', fotos: [{ id: 'f1' }] });

    it('mescla alterações, revalida condicionais e não regrava fotos', async () => {
      formRepo.findOne.mockResolvedValue(existing());

      await service.update('form-1', { occupation: 'Engenheira', state: 'rj', birthDate: '1991-01-01', fotos: [] } as any, 'org-1', 'user-1');

      const saved = savedForm();
      expect(saved).toEqual(expect.objectContaining({ occupation: 'Engenheira', state: 'RJ', birthDate: new Date('1991-01-01'), updatedBy: 'user-1' }));
      expect(saved).not.toHaveProperty('fotos');
    });

    it('rejeita edição que deixa condicional sem resposta', async () => {
      formRepo.findOne.mockResolvedValue(existing());

      const error = await service.update('form-1', { sawAdOn: 'other' }, 'org-1').catch((e) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse().message).toEqual(['Informe onde viu a divulgação.']);
      expect(formRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('updateStatus', () => {
    beforeEach(() => formRepo.findOne.mockResolvedValue({ id: 'form-1', fotos: [] }));

    it('grava status, observações e quem avaliou', async () => {
      await service.updateStatus('form-1', { status: AdoptionFormStatus.APROVADO, reviewNotes: 'Ok' }, 'org-1', 'user-1');

      expect(formRepo.update).toHaveBeenCalledWith('form-1', {
        status: 'APROVADO',
        reviewNotes: 'Ok',
        reviewedBy: 'user-1',
        reviewedAt: expect.any(Date),
        updatedBy: 'user-1',
      });
    });

    it('mantém as observações quando não são enviadas', async () => {
      await service.updateStatus('form-1', { status: AdoptionFormStatus.EM_ANALISE }, 'org-1', 'user-1');

      expect(formRepo.update.mock.calls[0][1]).not.toHaveProperty('reviewNotes');
    });
  });

  it('remove faz soft delete dentro da organização', async () => {
    formRepo.findOne.mockResolvedValue({ id: 'form-1', fotos: [] });

    const result = await service.remove('form-1', 'org-1', 'user-1');

    expect(formRepo.update).toHaveBeenCalledWith('form-1', { isActive: false, updatedBy: 'user-1' });
    expect(result.message).toBe('Ficha de adoção removida com sucesso.');
  });

  describe('addPhotos', () => {
    beforeEach(() => formRepo.findOne.mockResolvedValue({ id: 'form-1', fotos: [] }));

    it('exige ao menos uma foto', async () => {
      await expect(service.addPhotos('form-1', [], 'org-1')).rejects.toThrow(BadRequestException);
    });

    it(`respeita o limite de ${MAX_ADOPTION_FORM_PHOTOS} fotos`, async () => {
      photoRepo.count.mockResolvedValue(MAX_ADOPTION_FORM_PHOTOS);

      await expect(service.addPhotos('form-1', [file()], 'org-1')).rejects.toThrow('restam 0');
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('envia e salva com createdBy', async () => {
      photoRepo.count.mockResolvedValue(1);

      await service.addPhotos('form-1', [file()], 'org-1', 'user-1');

      expect(photoRepo.save).toHaveBeenCalledWith([expect.objectContaining({ adoptionFormId: 'form-1', createdBy: 'user-1' })]);
    });
  });

  describe('removePhoto', () => {
    beforeEach(() => formRepo.findOne.mockResolvedValue({ id: 'form-1', fotos: [] }));

    it('lança NotFoundException quando a foto não é da ficha', async () => {
      photoRepo.findOne.mockResolvedValue(null);

      await expect(service.removePhoto('form-1', 'f1', 'org-1')).rejects.toThrow('Foto não encontrada.');
    });

    it('remove do storage e do banco', async () => {
      photoRepo.findOne.mockResolvedValue({ id: 'f1', storagePath: 'adoption-forms/form-1/f1.png' });

      await service.removePhoto('form-1', 'f1', 'org-1');

      expect(storage.remove).toHaveBeenCalledWith(['adoption-forms/form-1/f1.png']);
      expect(photoRepo.delete).toHaveBeenCalledWith('f1');
    });
  });
});
