import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { FindOperator } from 'typeorm';
import { AdoptionFormService, MAX_ADOPTION_FORM_PHOTOS } from './adoption-form.service';
import { AdoptionFormStatus } from './adoption-form.entity';
import { PetStatus } from '../pet/pet.entity';
import { AdoptionHistoryType } from '../adoption-history/adoption-history.entity';
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
  let petRepo: MockRepository;
  let txFormRepo: MockRepository;
  let txPetRepo: MockRepository;
  let txContractRepo: MockRepository;
  let contractRepo: MockRepository;
  let autentique: { deleteDocument: jest.Mock };
  let manager: { getRepository: jest.Mock };
  let history: { record: jest.Mock; resolveUserName: jest.Mock; findByForm: jest.Mock };
  let storage: { uploadPrivate: jest.Mock; removePrivate: jest.Mock; getSignedUrls: jest.Mock };
  let service: AdoptionFormService;

  beforeEach(() => {
    formRepo = createMockRepository();
    photoRepo = createMockRepository();
    orgRepo = createMockRepository();
    petRepo = createMockRepository();
    // Repositórios usados dentro da transação do updateStatus
    txFormRepo = createMockRepository();
    txPetRepo = createMockRepository();
    txContractRepo = createMockRepository();
    manager = { getRepository: jest.fn((entity) => ({ Pet: txPetRepo, AdoptionContract: txContractRepo })[entity.name] ?? txFormRepo) };
    contractRepo = createMockRepository();
    autentique = { deleteDocument: jest.fn(async () => undefined) };
    (formRepo as any).manager = { transaction: jest.fn(async (work) => work(manager)) };
    history = {
      record: jest.fn(async () => undefined),
      resolveUserName: jest.fn(async () => 'Ana Admin'),
      findByForm: jest.fn(async () => []),
    };
    storage = {
      uploadPrivate: jest.fn(async () => undefined),
      removePrivate: jest.fn(async () => undefined),
      getSignedUrls: jest.fn(async (paths: string[]) => Object.fromEntries(paths.map((path) => [path, `https://signed/${path}`]))),
    };
    service = new AdoptionFormService(formRepo as any, photoRepo as any, orgRepo as any, petRepo as any, storage as any, history as any, contractRepo as any, autentique as any);

    orgRepo.findOne.mockResolvedValue({ id: 'org-1' });
    formRepo.save.mockImplementation(async (data) => ({ id: 'form-1', status: AdoptionFormStatus.PENDENTE, createdAt: new Date('2026-09-30'), ...data }));
  });

  const savedForm = () => formRepo.save.mock.calls[0][0];
  const recorded = (index = 0) => history.record.mock.calls[index][0];

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

      expect(savedForm()).toEqual(expect.objectContaining({ fullName: 'Maria', state: 'SP', birthDate: new Date(1990, 4, 10) }));
      expect(storage.uploadPrivate).toHaveBeenCalledTimes(2);
      expect(storage.uploadPrivate.mock.calls[0][0]).toMatch(/^adoption-forms\/form-1\/[0-9a-f-]{36}\.png$/);
      expect(photoRepo.save).toHaveBeenCalledWith([
        expect.objectContaining({ adoptionFormId: 'form-1', url: null, createdBy: null }),
        expect.objectContaining({ adoptionFormId: 'form-1', url: null, createdBy: null }),
      ]);
      expect(result).toEqual({ id: 'form-1', status: 'PENDENTE', createdAt: new Date('2026-09-30'), message: 'Ficha de adoção enviada com sucesso.' });
      expect(result).not.toHaveProperty('cpf');
      expect(recorded()).toEqual(
        expect.objectContaining({ type: AdoptionHistoryType.FICHA_CRIADA, toStatus: 'PENDENTE', description: 'Ficha enviada pelo formulário público' }),
      );
      expect(recorded().userId).toBeUndefined();
    });

    it('apaga a ficha e os arquivos enviados quando o upload falha', async () => {
      storage.uploadPrivate.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('storage fora'));

      await expect(service.create(baseDto(), [file(), file()])).rejects.toThrow('storage fora');

      expect(storage.removePrivate).toHaveBeenCalledWith([expect.stringMatching(/^adoption-forms\/form-1\//)]);
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

    it('devolve URLs assinadas de todas as fichas numa única chamada', async () => {
      formRepo.findAndCount.mockResolvedValue([
        [
          { id: 'f1', fotos: [{ id: 'a', storagePath: 'adoption-forms/f1/a.png', createdAt: new Date(1) }] },
          { id: 'f2', fotos: [{ id: 'b', storagePath: 'adoption-forms/f2/b.png', createdAt: new Date(1) }] },
        ],
        2,
      ]);

      const result = await service.findAll(pagination, 'org-1');

      expect(storage.getSignedUrls).toHaveBeenCalledTimes(1);
      expect(storage.getSignedUrls).toHaveBeenCalledWith(['adoption-forms/f1/a.png', 'adoption-forms/f2/b.png']);
      expect(result.data.map((form) => form.fotos[0].url)).toEqual(['https://signed/adoption-forms/f1/a.png', 'https://signed/adoption-forms/f2/b.png']);
    });
  });

  describe('findOne', () => {
    it('busca só dentro da organização do usuário', async () => {
      formRepo.findOne.mockResolvedValue({ id: 'form-1', fotos: [] });

      await service.findOne('form-1', 'org-1');

      expect(formRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'form-1', organizationId: 'org-1', isActive: true },
        relations: { fotos: true, pet: { fotos: true } },
      });
    });

    it('devolve o pet vinculado resumido', async () => {
      formRepo.findOne.mockResolvedValue({
        id: 'form-1',
        fotos: [],
        petId: 'pet-1',
        pet: { id: 'pet-1', name: 'Rex', species: 'Cachorro', status: 'EM_PROCESSO', fotos: [{ url: 'https://p/2.png', createdAt: new Date(2) }, { url: 'https://p/1.png', createdAt: new Date(1) }] },
      });

      const form = await service.findOne('form-1', 'org-1');

      expect(form.pet).toEqual({ id: 'pet-1', name: 'Rex', species: 'Cachorro', fotos: [{ url: 'https://p/1.png' }, { url: 'https://p/2.png' }] });
    });

    it('devolve pet null quando não há vínculo', async () => {
      formRepo.findOne.mockResolvedValue({ id: 'form-1', fotos: [] });

      expect((await service.findOne('form-1', 'org-1')).pet).toBeNull();
    });

    it('troca a URL das fotos por uma URL assinada', async () => {
      formRepo.findOne.mockResolvedValue({ id: 'form-1', fotos: [{ id: 'a', url: null, storagePath: 'adoption-forms/form-1/a.png', createdAt: new Date(1) }] });

      const form = await service.findOne('form-1', 'org-1');

      expect(form.fotos[0].url).toBe('https://signed/adoption-forms/form-1/a.png');
    });

    it('mantém a URL gravada quando a foto não está no bucket privado (fichas antigas)', async () => {
      storage.getSignedUrls.mockResolvedValue({});
      formRepo.findOne.mockResolvedValue({ id: 'form-1', fotos: [{ id: 'a', url: 'https://public/a.png', storagePath: 'adoption-forms/form-1/a.png', createdAt: new Date(1) }] });

      const form = await service.findOne('form-1', 'org-1');

      expect(form.fotos[0].url).toBe('https://public/a.png');
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
      expect(saved).toEqual(expect.objectContaining({ occupation: 'Engenheira', state: 'RJ', birthDate: new Date(1991, 0, 1), updatedBy: 'user-1' }));
      expect(saved).not.toHaveProperty('fotos');
    });

    it('registra FICHA_EDITADA com os campos alterados e rótulos', async () => {
      formRepo.findOne.mockResolvedValue(existing());

      await service.update('form-1', { occupation: 'Engenheira', state: 'rj', birthDate: '1990-05-10' } as any, 'org-1', 'user-1');

      expect(recorded()).toEqual(
        expect.objectContaining({
          type: AdoptionHistoryType.FICHA_EDITADA,
          description: 'Ficha editada: Profissão, UF',
          userId: 'user-1',
          metadata: {
            fields: [
              { field: 'occupation', label: 'Profissão', before: 'Designer', after: 'Engenheira' },
              { field: 'state', label: 'UF', before: 'SP', after: 'RJ' },
            ],
          },
        }),
      );
    });

    it('não registra evento quando nada muda', async () => {
      formRepo.findOne.mockResolvedValue(existing());

      await service.update('form-1', { occupation: 'Designer' } as any, 'org-1', 'user-1');

      expect(history.record).not.toHaveBeenCalled();
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
    const formWith = (status: AdoptionFormStatus, petId: string = null) =>
      formRepo.findOne.mockResolvedValue({ id: 'form-1', organizationId: 'org-1', fullName: 'Maria', status, petId, fotos: [] });

    beforeEach(() => formWith(AdoptionFormStatus.PENDENTE));

    it('grava status, observações e quem avaliou dentro da transação', async () => {
      await service.updateStatus('form-1', { status: AdoptionFormStatus.APROVADO, reviewNotes: 'Ok' }, 'org-1', 'user-1');

      expect(txFormRepo.update).toHaveBeenCalledWith('form-1', {
        status: 'APROVADO',
        reviewNotes: 'Ok',
        reviewedBy: 'user-1',
        reviewedAt: expect.any(Date),
        updatedBy: 'user-1',
      });
    });

    it('mantém as observações quando não são enviadas', async () => {
      await service.updateStatus('form-1', { status: AdoptionFormStatus.APROVADO }, 'org-1', 'user-1');

      expect(txFormRepo.update.mock.calls[0][1]).not.toHaveProperty('reviewNotes');
    });

    it('registra STATUS_ALTERADO na mesma transação, com observações', async () => {
      await service.updateStatus('form-1', { status: AdoptionFormStatus.REPROVADO, reviewNotes: 'Sem tela' }, 'org-1', 'user-1');

      expect(history.record).toHaveBeenCalledWith(
        expect.objectContaining({
          type: AdoptionHistoryType.STATUS_ALTERADO,
          fromStatus: 'PENDENTE',
          toStatus: 'REPROVADO',
          description: 'Status alterado de Pendente para Reprovado',
          metadata: { reviewNotes: 'Sem tela' },
          userId: 'user-1',
          userName: 'Ana Admin',
        }),
        manager,
      );
    });

    it.each([
      [AdoptionFormStatus.PENDENTE, AdoptionFormStatus.REPROVADO],
      [AdoptionFormStatus.REPROVADO, AdoptionFormStatus.APROVADO],
      [AdoptionFormStatus.APROVADO, AdoptionFormStatus.PENDENTE],
    ])('permite mover livremente de %s para %s', async (from, to) => {
      formWith(from);

      await expect(service.updateStatus('form-1', { status: to }, 'org-1', 'user-1', 'VOLUNTEER')).resolves.toBeDefined();
    });

    it('mesmo status só atualiza as observações e registra FICHA_EDITADA', async () => {
      formRepo.findOne.mockResolvedValue({ id: 'form-1', organizationId: 'org-1', fullName: 'Maria', status: 'AGUARDANDO_ASSINATURA', petId: 'pet-1', reviewNotes: 'Antiga', fotos: [] });

      await service.updateStatus('form-1', { status: AdoptionFormStatus.AGUARDANDO_ASSINATURA, reviewNotes: 'Nova' }, 'org-1', 'user-1', 'VOLUNTEER');

      expect(formRepo.update).toHaveBeenCalledWith('form-1', { reviewNotes: 'Nova', updatedBy: 'user-1' });
      expect(txFormRepo.update).not.toHaveBeenCalled();
      expect(txPetRepo.update).not.toHaveBeenCalled();
      expect(recorded()).toEqual(
        expect.objectContaining({
          type: AdoptionHistoryType.FICHA_EDITADA,
          description: 'Observações da avaliação atualizadas',
          metadata: { fields: [{ field: 'reviewNotes', label: 'Observações', before: 'Antiga', after: 'Nova' }] },
          userId: 'user-1',
        }),
      );
    });

    it('mesmo status sem mudar as observações não grava nada', async () => {
      await service.updateStatus('form-1', { status: AdoptionFormStatus.PENDENTE }, 'org-1');

      expect(formRepo.update).not.toHaveBeenCalled();
      expect(history.record).not.toHaveBeenCalled();
    });

    it('CONTRATO_GERADO (legado) não é mais destino', async () => {
      formWith(AdoptionFormStatus.APROVADO);

      await expect(service.updateStatus('form-1', { status: AdoptionFormStatus.CONTRATO_GERADO }, 'org-1', 'user-1', 'ADMIN')).rejects.toThrow(
        'Movimentação de status não permitida.',
      );
      expect(txFormRepo.update).not.toHaveBeenCalled();
    });

    it.each([AdoptionFormStatus.APROVADO, AdoptionFormStatus.AGUARDANDO_ASSINATURA])('não conclui manualmente a partir de %s', async (from) => {
      formWith(from);

      await expect(service.updateStatus('form-1', { status: AdoptionFormStatus.CONCLUIDA }, 'org-1', 'user-1', 'ADMIN')).rejects.toThrow(
        'A adoção é concluída automaticamente quando o adotante assina o termo de adoção.',
      );
      expect(txFormRepo.update).not.toHaveBeenCalled();
    });

    it('não permite mover manualmente para AGUARDANDO_ASSINATURA', async () => {
      formWith(AdoptionFormStatus.APROVADO);

      await expect(service.updateStatus('form-1', { status: AdoptionFormStatus.AGUARDANDO_ASSINATURA }, 'org-1', 'user-1', 'ADMIN')).rejects.toThrow(
        'Envie o termo de adoção para assinatura pela aba Termo de Adoção.',
      );
    });

    it('EM_ANALISE (legado) não é mais destino', async () => {
      formWith(AdoptionFormStatus.PENDENTE);

      await expect(service.updateStatus('form-1', { status: AdoptionFormStatus.EM_ANALISE }, 'org-1', 'user-1', 'ADMIN')).rejects.toThrow('Movimentação de status não permitida.');
    });

    it('ADMIN voltando de AGUARDANDO_ASSINATURA para APROVADO cancela o documento no Autentique', async () => {
      formWith(AdoptionFormStatus.AGUARDANDO_ASSINATURA, 'pet-1');
      contractRepo.findOne.mockResolvedValue({ id: 'contract-1', autentiqueDocumentId: 'doc-1', signatureStatus: 'PENDENTE' });

      await service.updateStatus('form-1', { status: AdoptionFormStatus.APROVADO }, 'org-1', 'user-1', 'ADMIN');

      expect(autentique.deleteDocument).toHaveBeenCalledWith('doc-1');
      expect(txContractRepo.update).toHaveBeenCalledWith({ adoptionFormId: 'form-1' }, { signatureStatus: 'CANCELADO', updatedBy: 'user-1' });
      expect(recorded().metadata).toEqual(expect.objectContaining({ cancelledSignatureDocumentId: 'doc-1' }));
    });

    it('falha ao excluir no Autentique não impede voltar para APROVADO', async () => {
      formWith(AdoptionFormStatus.AGUARDANDO_ASSINATURA);
      contractRepo.findOne.mockResolvedValue({ id: 'contract-1', autentiqueDocumentId: 'doc-1', signatureStatus: 'PENDENTE' });
      autentique.deleteDocument.mockRejectedValue(new Error('fora do ar'));

      await expect(service.updateStatus('form-1', { status: AdoptionFormStatus.APROVADO }, 'org-1', 'user-1', 'ADMIN')).resolves.toBeDefined();
      expect(txFormRepo.update).toHaveBeenCalledWith('form-1', expect.objectContaining({ status: AdoptionFormStatus.APROVADO }));
    });

    it.each([AdoptionFormStatus.AGUARDANDO_ASSINATURA, AdoptionFormStatus.CONCLUIDA])('de %s só volta para APROVADO', async (from) => {
      formWith(from);

      await expect(service.updateStatus('form-1', { status: AdoptionFormStatus.PENDENTE }, 'org-1', 'user-1', 'ADMIN')).rejects.toThrow(BadRequestException);
    });

    it.each([AdoptionFormStatus.AGUARDANDO_ASSINATURA, AdoptionFormStatus.CONCLUIDA])('voltar de %s para APROVADO é só para ADMIN', async (from) => {
      formWith(from, 'pet-1');

      await expect(service.updateStatus('form-1', { status: AdoptionFormStatus.APROVADO }, 'org-1', 'user-1', 'VOLUNTEER')).rejects.toThrow(ForbiddenException);
    });

    it('ADMIN volta de CONCLUIDA para APROVADO e o pet volta para EM_PROCESSO', async () => {
      formWith(AdoptionFormStatus.CONCLUIDA, 'pet-1');

      await service.updateStatus('form-1', { status: AdoptionFormStatus.APROVADO }, 'org-1', 'user-1', 'ADMIN');

      expect(txPetRepo.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'pet-1', organizationId: expect.any(String) }), { status: PetStatus.EM_PROCESSO, adoptionDate: null, updatedBy: 'user-1' });
    });

    it('sair de APROVADO para REPROVADO libera o pet vinculado', async () => {
      formWith(AdoptionFormStatus.APROVADO, 'pet-1');

      await service.updateStatus('form-1', { status: AdoptionFormStatus.REPROVADO }, 'org-1', 'user-1');

      expect(txPetRepo.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'pet-1', organizationId: expect.any(String) }), { status: PetStatus.DISPONIVEL, updatedBy: 'user-1' });
    });

    it('sem pet vinculado não mexe em pets', async () => {
      formWith(AdoptionFormStatus.APROVADO);

      await service.updateStatus('form-1', { status: AdoptionFormStatus.REPROVADO }, 'org-1', 'user-1');

      expect(txPetRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('board', () => {
    it('devolve as 5 colunas na ordem do kanban, com no máximo 50 itens por coluna', async () => {
      formRepo.findAndCount.mockImplementation(async ({ where }) =>
        where.status === 'APROVADO'
          ? [[{ id: 'f1', fullName: 'Maria', status: 'APROVADO', petId: 'pet-1', pet: { name: 'Rex' }, cpf: '1', reviewNotes: 'x' }], 1]
          : [[], 0],
      );

      const { columns } = await service.board('org-1');

      expect(columns.map((column) => column.status)).toEqual(['PENDENTE', 'APROVADO', 'AGUARDANDO_ASSINATURA', 'CONCLUIDA', 'REPROVADO']);
      expect(formRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: 'org-1', isActive: true, status: 'PENDENTE' }, order: { updatedAt: 'DESC' }, take: 50 }),
      );
      const approved = columns[1];
      expect(approved.total).toBe(1);
      expect(approved.items[0]).toEqual(expect.objectContaining({ id: 'f1', fullName: 'Maria', petId: 'pet-1', petName: 'Rex' }));
      expect(approved.items[0]).not.toHaveProperty('cpf');
    });

    it('aplica a busca em todas as colunas', async () => {
      await service.board('org-1', 'maria');

      const where = formRepo.findAndCount.mock.calls[0][0].where;
      expect(where).toHaveLength(3);
      expect(where[0].fullName.value).toBe('%maria%');
    });
  });

  it('findHistory valida a ficha da organização antes de listar', async () => {
    formRepo.findOne.mockResolvedValue(null);

    await expect(service.findHistory('form-1', 'org-2')).rejects.toThrow(NotFoundException);
    expect(history.findByForm).not.toHaveBeenCalled();
  });

  it('remove faz soft delete dentro da organização', async () => {
    formRepo.findOne.mockResolvedValue({ id: 'form-1', fotos: [] });

    const result = await service.remove('form-1', 'org-1', 'user-1');

    expect(formRepo.update).toHaveBeenCalledWith('form-1', { isActive: false, updatedBy: 'user-1' });
    expect(result.message).toBe('Ficha de adoção removida com sucesso.');
    expect(storage.removePrivate).not.toHaveBeenCalled();
    expect(recorded()).toEqual(expect.objectContaining({ type: AdoptionHistoryType.FICHA_REMOVIDA, userId: 'user-1' }));
  });

  it('remove libera o pet reservado para a ficha', async () => {
    formRepo.findOne.mockResolvedValue({ id: 'form-1', status: 'APROVADO', petId: 'pet-1', fotos: [] });

    await service.remove('form-1', 'org-1', 'user-1');

    expect(petRepo.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'pet-1', organizationId: expect.any(String), status: PetStatus.EM_PROCESSO }), { status: PetStatus.DISPONIVEL, updatedBy: 'user-1' });
  });

  it('remove apaga as fotos da residência do storage e do banco', async () => {
    formRepo.findOne.mockResolvedValue({
      id: 'form-1',
      fotos: [
        { id: 'a', storagePath: 'adoption-forms/form-1/a.png', createdAt: new Date(1) },
        { id: 'b', storagePath: 'adoption-forms/form-1/b.png', createdAt: new Date(2) },
      ],
    });

    await service.remove('form-1', 'org-1', 'user-1');

    expect(storage.removePrivate).toHaveBeenCalledWith(['adoption-forms/form-1/a.png', 'adoption-forms/form-1/b.png']);
    expect(photoRepo.delete).toHaveBeenCalledWith({ adoptionFormId: 'form-1' });
    expect(formRepo.update).toHaveBeenCalledWith('form-1', { isActive: false, updatedBy: 'user-1' });
  });

  describe('addPhotos', () => {
    beforeEach(() => formRepo.findOne.mockResolvedValue({ id: 'form-1', fotos: [] }));

    it('exige ao menos uma foto', async () => {
      await expect(service.addPhotos('form-1', [], 'org-1')).rejects.toThrow(BadRequestException);
    });

    it(`respeita o limite de ${MAX_ADOPTION_FORM_PHOTOS} fotos`, async () => {
      photoRepo.count.mockResolvedValue(MAX_ADOPTION_FORM_PHOTOS);

      await expect(service.addPhotos('form-1', [file()], 'org-1')).rejects.toThrow('restam 0');
      expect(storage.uploadPrivate).not.toHaveBeenCalled();
    });

    it('envia e salva com createdBy', async () => {
      photoRepo.count.mockResolvedValue(1);

      await service.addPhotos('form-1', [file()], 'org-1', 'user-1');

      expect(photoRepo.save).toHaveBeenCalledWith([expect.objectContaining({ adoptionFormId: 'form-1', createdBy: 'user-1' })]);
      expect(recorded()).toEqual(
        expect.objectContaining({ type: AdoptionHistoryType.FOTO_ADICIONADA, description: '1 foto adicionada', metadata: { count: 1 }, userId: 'user-1' }),
      );
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

      await service.removePhoto('form-1', 'f1', 'org-1', 'user-1');

      expect(storage.removePrivate).toHaveBeenCalledWith(['adoption-forms/form-1/f1.png']);
      expect(photoRepo.delete).toHaveBeenCalledWith('f1');
      expect(recorded()).toEqual(expect.objectContaining({ type: AdoptionHistoryType.FOTO_REMOVIDA, metadata: { photoId: 'f1' }, userId: 'user-1' }));
    });
  });
});
