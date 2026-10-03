import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdoptionContractService } from './adoption-contract.service';
import { AdoptionFormStatus } from '../adoption-form/adoption-form.entity';
import { PetStatus } from '../pet/pet.entity';
import { AdoptionHistoryType } from '../adoption-history/adoption-history.entity';
import { CONTRACT_TEMPLATE } from './contract-template';
import { buildInitialData } from './contract-data';
import { createMockRepository, MockRepository } from '../testing/mock-repository';
import { buildContractPdf, loadImageAsDataUrl } from './contract-pdf.builder';

jest.mock('./contract-pdf.builder', () => ({
  buildContractPdf: jest.fn(async () => ({
    buffer: Buffer.from('%PDF-fake'),
    adopterSignature: { page: 4, x: 62.99, y: 30.81 },
    organizationSignature: { page: 4, x: 10.4, y: 30.81 },
  })),
  loadImageAsDataUrl: jest.fn(async () => 'data:image/png;base64,AAAA'),
}));

const baseForm = (status = AdoptionFormStatus.APROVADO, petId: string = null) => ({
  id: 'form-1',
  organizationId: 'org-1',
  fullName: 'Maria da Silva',
  email: 'maria@teste.com',
  birthDate: '1990-05-10',
  cpf: '52998224725',
  phone: '41987654321',
  occupation: 'Designer',
  zipCode: '80010000',
  street: 'Rua das Flores',
  number: '100',
  complement: 'Apto 12',
  neighborhood: 'Centro',
  city: 'Curitiba',
  state: 'PR',
  status,
  petId,
});

const templateClauses = () =>
  CONTRACT_TEMPLATE.map((clause, index) => ({ key: clause.key, order: index + 1, content: clause.content, originalContent: clause.content, removed: false }));

const storedContract = (overrides: Record<string, any> = {}) => ({
  id: 'contract-1',
  adoptionFormId: 'form-1',
  organizationId: 'org-1',
  petId: null,
  data: buildInitialData(baseForm() as any),
  clauses: templateClauses(),
  version: 0,
  pdfStoragePath: null,
  generatedAt: null,
  updatedAt: new Date('2026-10-01'),
  ...overrides,
});

// Documento como o AutentiqueService devolve: dono da conta + adotante
const autentiqueDocument = (adopter: Record<string, any> = {}) => ({
  id: 'doc-1',
  name: 'Termo de Adoção',
  signedFileUrl: 'https://api.autentique.com.br/documentos/doc-1/assinado.pdf',
  signatures: [
    { publicId: 'sig-owner', name: 'ONG', email: 'ong@teste.com', link: null, viewedAt: null, signedAt: null, rejectedAt: null },
    { publicId: 'sig-1', name: 'Maria da Silva', email: 'maria@teste.com', link: 'https://assina.ae/abc', viewedAt: null, signedAt: null, rejectedAt: null, ...adopter },
  ],
});

// Contrato já enviado e aguardando a assinatura do adotante
const sentContract = (overrides: Record<string, any> = {}) =>
  storedContract({
    petId: 'pet-1',
    version: 2,
    pdfStoragePath: 'contracts/form-1/v2.pdf',
    autentiqueDocumentId: 'doc-1',
    signatureStatus: 'PENDENTE',
    signatureEmail: 'maria@teste.com',
    signatureVersion: 2,
    ...overrides,
  });

// Payload de cláusulas como o front envia
const clausesPayload = (change: (clause: any) => any = (clause) => clause) =>
  templateClauses().map(({ key, order, content, removed }) => change({ key, order, content, removed }));

describe('AdoptionContractService', () => {
  let contractRepo: MockRepository;
  let formRepo: MockRepository;
  let petRepo: MockRepository;
  let tx: { contract: MockRepository; form: MockRepository; pet: MockRepository };
  let manager: { getRepository: jest.Mock };
  let storage: { uploadPrivate: jest.Mock; removePrivate: jest.Mock; downloadPrivate: jest.Mock; getSignedUrls: jest.Mock };
  let autentique: { createDocument: jest.Mock; getDocument: jest.Mock; deleteDocument: jest.Mock; downloadFile: jest.Mock; getAccount: jest.Mock; signDocument: jest.Mock };
  let history: { resolveUserName: jest.Mock; recordMany: jest.Mock; findByForm: jest.Mock };
  let service: AdoptionContractService;

  beforeEach(() => {
    jest.clearAllMocks();
    contractRepo = createMockRepository();
    formRepo = createMockRepository();
    petRepo = createMockRepository();
    tx = { contract: createMockRepository(), form: createMockRepository(), pet: createMockRepository() };
    manager = {
      getRepository: jest.fn((entity) => ({ AdoptionContract: tx.contract, AdoptionForm: tx.form, Pet: tx.pet })[entity.name]),
    };
    (contractRepo as any).manager = { transaction: jest.fn(async (work) => work(manager)) };
    storage = {
      uploadPrivate: jest.fn(async () => undefined),
      removePrivate: jest.fn(async () => undefined),
      downloadPrivate: jest.fn(async () => Buffer.from('%PDF-v1')),
      getSignedUrls: jest.fn(async (paths: string[]) => Object.fromEntries(paths.map((path) => [path, `https://signed/${path}`]))),
    };
    history = {
      resolveUserName: jest.fn(async () => 'Ana Admin'),
      recordMany: jest.fn(async () => []),
      findByForm: jest.fn(async () => []),
    };
    autentique = {
      createDocument: jest.fn(async () => autentiqueDocument()),
      getDocument: jest.fn(async () => autentiqueDocument()),
      deleteDocument: jest.fn(async () => undefined),
      downloadFile: jest.fn(async () => Buffer.from('%PDF-assinado')),
      getAccount: jest.fn(async () => ({ name: 'Júlia Dezordi Ruas', email: 'ong@teste.com' })),
      signDocument: jest.fn(async () => undefined),
    };
    service = new AdoptionContractService(contractRepo as any, formRepo as any, petRepo as any, storage as any, history as any, autentique as any);

    formRepo.findOne.mockResolvedValue(baseForm());
    contractRepo.findOne.mockResolvedValue(storedContract());
    contractRepo.save.mockImplementation(async (data) => ({ id: 'contract-1', ...data }));
  });

  const recordedEvents = () => history.recordMany.mock.calls.flatMap((call) => call[0]);

  describe('findByForm', () => {
    it.each([AdoptionFormStatus.PENDENTE, AdoptionFormStatus.REPROVADO])('bloqueia ficha %s', async (status) => {
      formRepo.findOne.mockResolvedValue(baseForm(status));

      await expect(service.findByForm('form-1', 'org-1')).rejects.toThrow('O termo de adoção só pode ser gerado para fichas aprovadas.');
    });

    it('lança 404 para ficha de outra organização', async () => {
      formRepo.findOne.mockResolvedValue(null);

      await expect(service.findByForm('form-1', 'org-2')).rejects.toThrow(NotFoundException);
    });

    it('cria o rascunho do modelo pré-preenchido com a ficha e o pet vinculado', async () => {
      formRepo.findOne.mockResolvedValue(baseForm(AdoptionFormStatus.APROVADO, 'pet-1'));
      contractRepo.findOne.mockResolvedValue(null);
      petRepo.findOne.mockResolvedValue({ id: 'pet-1', name: 'Rex', species: 'Cachorro', sex: 'Macho', animal: 'Vira-lata', age: 2, castration: true, fotos: [] });

      const contract = await service.findByForm('form-1', 'org-1', 'user-1');

      const saved = contractRepo.save.mock.calls[0][0];
      expect(saved).toEqual(expect.objectContaining({ adoptionFormId: 'form-1', organizationId: 'org-1', petId: 'pet-1', version: 0, createdBy: 'user-1' }));
      expect(saved.data.adopter).toEqual(
        expect.objectContaining({
          name: 'Maria da Silva',
          birthDate: '1990-05-10',
          cpf: '52998224725',
          profession: 'Designer',
          address: 'Rua das Flores, nº 100 - Apto 12 - Centro - Curitiba/PR - CEP 80010-000',
          rg: '',
        }),
      );
      expect(saved.data.adopter.age).toMatch(/^\d+ anos$/);
      expect(saved.data.animal).toEqual(expect.objectContaining({ name: 'Rex', species: 'CANINA', sex: 'MACHO', breed: 'Vira-lata', age: '2 anos', castrated: true }));
      expect(saved.data.signature).toEqual({ city: 'Curitiba/PR', date: null });
      expect(contract.clauses).toHaveLength(14);
      expect(contract.clauses[0]).toEqual(expect.objectContaining({ key: 'animal', locked: true }));
      expect(contract.clauses[1].locked).toBe(false);
      expect(contract.pet).toEqual({ id: 'pet-1', name: 'Rex', species: 'Cachorro', fotos: [] });
      expect(contract.pdfUrl).toBeNull();
    });

    it('lista as versões geradas do histórico com URL assinada', async () => {
      contractRepo.findOne.mockResolvedValue(storedContract({ version: 2, pdfStoragePath: 'contracts/form-1/v2.pdf' }));
      history.findByForm.mockResolvedValue([
        { type: 'CONTRATO_GERADO', metadata: { version: 2, storagePath: 'contracts/form-1/v2.pdf' }, createdAt: new Date(2), userName: 'Ana' },
        { type: 'STATUS_ALTERADO', metadata: null },
        { type: 'CONTRATO_GERADO', metadata: { version: 1, storagePath: 'contracts/form-1/v1.pdf' }, createdAt: new Date(1), userName: 'Bia' },
      ]);

      const contract = await service.findByForm('form-1', 'org-1');

      expect(contract.pdfUrl).toBe('https://signed/contracts/form-1/v2.pdf');
      expect(contract.versions).toEqual([
        { version: 2, generatedAt: new Date(2), url: 'https://signed/contracts/form-1/v2.pdf', userName: 'Ana' },
        { version: 1, generatedAt: new Date(1), url: 'https://signed/contracts/form-1/v1.pdf', userName: 'Bia' },
      ]);
    });
  });

  describe('update', () => {
    it('adoção concluída é só leitura', async () => {
      formRepo.findOne.mockResolvedValue(baseForm(AdoptionFormStatus.CONCLUIDA));

      await expect(service.update('form-1', { data: {} }, 'org-1')).rejects.toThrow('Adoção concluída: o termo de adoção não pode mais ser alterado.');
    });

    it('salva dados aceitando só chaves conhecidas e registra CONTRATO_DADOS_ALTERADOS', async () => {
      await service.update('form-1', { data: { adopter: { rg: ' 12.345.678-9 ', hack: 'x' }, animal: { coat: 'Caramelo' }, extra: 1 } }, 'org-1', 'user-1');

      const saved = tx.contract.update.mock.calls[0][1];
      expect(saved.data.adopter.rg).toBe('12.345.678-9');
      expect(saved.data.adopter).not.toHaveProperty('hack');
      expect(saved.data).not.toHaveProperty('extra');
      expect(saved.data.animal.coat).toBe('Caramelo');
      expect(recordedEvents()).toEqual([
        expect.objectContaining({
          type: AdoptionHistoryType.CONTRATO_DADOS_ALTERADOS,
          description: 'Dados do termo de adoção alterados: RG do adotante, Pelagem do animal',
          userId: 'user-1',
          userName: 'Ana Admin',
          metadata: {
            fields: [
              { field: 'adopter.rg', label: 'RG do adotante', before: '', after: '12.345.678-9' },
              { field: 'animal.coat', label: 'Pelagem do animal', before: '', after: 'Caramelo' },
            ],
          },
        }),
      ]);
      expect(history.recordMany.mock.calls[0][1]).toBe(manager);
    });

    it('rejeita dados inválidos com mensagens em PT-BR', async () => {
      const error = await service
        .update('form-1', { data: { animal: { species: 'CAVALO', castrated: 'sim' }, signature: { date: '02/10/2026' } } }, 'org-1')
        .catch((e) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse().message).toEqual([
        'Espécie do animal deve ser CANINA ou FELINA.',
        'Castrado: informe true, false ou null.',
        'Data da assinatura deve estar no formato YYYY-MM-DD.',
      ]);
      expect(tx.contract.update).not.toHaveBeenCalled();
    });

    it('sem mudanças não grava evento', async () => {
      await service.update('form-1', { data: { adopter: { name: 'Maria da Silva' } } }, 'org-1');

      expect(recordedEvents()).toEqual([]);
    });

    describe('cláusulas', () => {
      it('remover registra CLAUSULA_REMOVIDA com o número que ela tinha', async () => {
        await service.update('form-1', { clauses: clausesPayload((c) => (c.key === 'vacina_castracao' ? { ...c, removed: true } : c)) }, 'org-1', 'user-1');

        expect(recordedEvents()).toEqual([
          expect.objectContaining({
            type: AdoptionHistoryType.CLAUSULA_REMOVIDA,
            description: 'Cláusula Terceira (Vacina e castração) removida',
            metadata: expect.objectContaining({ clauseKey: 'vacina_castracao', clauseNumber: 3, after: null }),
          }),
        ]);
        const saved = tx.contract.update.mock.calls[0][1].clauses;
        expect(saved.find((c) => c.key === 'vacina_castracao').removed).toBe(true);
      });

      it('editar registra CLAUSULA_EDITADA com antes/depois e o número atual', async () => {
        await service.update(
          'form-1',
          {
            clauses: clausesPayload((c) => {
              if (c.key === 'vacina_castracao') return { ...c, removed: true };
              if (c.key === 'multa') return { ...c, content: 'Multa de R$ 2.000,00.' };
              return c;
            }),
          },
          'org-1',
        );

        const edited = recordedEvents().find((event) => event.type === AdoptionHistoryType.CLAUSULA_EDITADA);
        expect(edited.description).toBe('Cláusula Décima Primeira (Multa) editada');
        expect(edited.metadata).toEqual(expect.objectContaining({ clauseNumber: 11, after: 'Multa de R$ 2.000,00.' }));
        expect(edited.metadata.before).toContain('R$ 1.000,00');
      });

      it('restaurar registra CLAUSULA_RESTAURADA', async () => {
        const clauses = templateClauses().map((c) => (c.key === 'foro' ? { ...c, removed: true } : c));
        contractRepo.findOne.mockResolvedValue(storedContract({ clauses }));

        await service.update('form-1', { clauses: clausesPayload() }, 'org-1');

        expect(recordedEvents()).toEqual([
          expect.objectContaining({ type: AdoptionHistoryType.CLAUSULA_RESTAURADA, description: 'Cláusula Décima Quarta (Foro) restaurada' }),
        ]);
      });

      it('reordena pelo order e grava o texto original do modelo', async () => {
        await service.update('form-1', { clauses: clausesPayload((c) => (c.key === 'foro' ? { ...c, order: 0, content: 'Foro de Curitiba.\r\n' } : c)) }, 'org-1');

        const saved = tx.contract.update.mock.calls[0][1].clauses;
        expect(saved[0]).toEqual(expect.objectContaining({ key: 'foro', order: 1, content: 'Foro de Curitiba.' }));
        expect(saved[0].originalContent).toBe(CONTRACT_TEMPLATE.find((c) => c.key === 'foro').content);
        expect(saved.map((c) => c.order)).toEqual(Array.from({ length: 14 }, (_v, i) => i + 1));
      });

      it.each([
        ['chave desconhecida', () => [...clausesPayload(), { key: 'nova', order: 15, content: 'x', removed: false }], 'Cláusula desconhecida: nova.'],
        ['cláusula faltando', () => clausesPayload().filter((c) => c.key !== 'foro'), 'Envie todas as cláusulas do termo de adoção. Faltando: foro.'],
        ['cláusula travada removida', () => clausesPayload((c) => (c.key === 'animal' ? { ...c, removed: true } : c)), 'A cláusula "Identificação do animal" não pode ser removida.'],
        ['texto vazio', () => clausesPayload((c) => (c.key === 'danos' ? { ...c, content: '  ' } : c)), 'O texto da cláusula "Danos causados pelo animal" não pode ficar vazio.'],
        ['cláusula repetida', () => [...clausesPayload(), { key: 'foro', order: 15, content: 'x', removed: false }], 'Cláusula repetida: foro.'],
      ])('rejeita %s', async (_label, payload, message) => {
        const error = await service.update('form-1', { clauses: payload() }, 'org-1').catch((e) => e);

        expect(error).toBeInstanceOf(BadRequestException);
        expect(error.getResponse().message).toContain(message);
      });
    });

    describe('pet', () => {
      it('vincula o pet: preenche campos vazios do animal, reserva o pet e libera o anterior', async () => {
        const data = buildInitialData(baseForm() as any);
        data.animal.name = 'Nome digitado';
        contractRepo.findOne.mockResolvedValue(storedContract({ petId: 'pet-old', data }));
        petRepo.findOne.mockImplementation(async ({ where }) =>
          where.id === 'pet-new'
            ? { id: 'pet-new', name: 'Mia', species: 'Gato', sex: 'Femea', status: PetStatus.DISPONIVEL, castration: false }
            : { id: 'pet-old', name: 'Rex', status: PetStatus.EM_PROCESSO },
        );

        await service.update('form-1', { petId: 'pet-new' }, 'org-1', 'user-1');

        const saved = tx.contract.update.mock.calls[0][1];
        expect(saved.petId).toBe('pet-new');
        expect(saved.data.animal).toEqual(expect.objectContaining({ name: 'Nome digitado', species: 'FELINA', sex: 'FEMEA', castrated: false }));
        expect(tx.form.update).toHaveBeenCalledWith('form-1', { petId: 'pet-new', updatedBy: 'user-1' });
        expect(tx.pet.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'pet-old', organizationId: expect.any(String) }), { status: PetStatus.DISPONIVEL, updatedBy: 'user-1' });
        expect(tx.pet.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'pet-new', organizationId: expect.any(String) }), { status: PetStatus.EM_PROCESSO, updatedBy: 'user-1' });
        expect(recordedEvents()).toEqual([
          expect.objectContaining({
            type: AdoptionHistoryType.PET_VINCULADO,
            description: 'Pet Mia vinculado ao termo de adoção',
            metadata: { before: { id: 'pet-old', name: 'Rex' }, after: { id: 'pet-new', name: 'Mia' } },
          }),
        ]);
      });

      it('busca o pet só na organização do usuário', async () => {
        petRepo.findOne.mockResolvedValue(null);

        await expect(service.update('form-1', { petId: 'pet-x' }, 'org-1')).rejects.toThrow('Pet não encontrado.');
        expect(petRepo.findOne).toHaveBeenCalledWith({ where: { id: 'pet-x', organizationId: 'org-1', isActive: true } });
      });

      it('não vincula pet já adotado', async () => {
        petRepo.findOne.mockResolvedValue({ id: 'pet-1', status: PetStatus.ADOTADO });

        await expect(service.update('form-1', { petId: 'pet-1' }, 'org-1')).rejects.toThrow('O pet selecionado não está disponível para adoção.');
      });

      it('mesmo pet não gera evento nem mexe em pets', async () => {
        contractRepo.findOne.mockResolvedValue(storedContract({ petId: 'pet-1' }));

        await service.update('form-1', { petId: 'pet-1' }, 'org-1');

        expect(tx.pet.update).not.toHaveBeenCalled();
        expect(recordedEvents()).toEqual([]);
      });

      it('petId null desvincula', async () => {
        contractRepo.findOne.mockResolvedValue(storedContract({ petId: 'pet-1' }));
        petRepo.findOne.mockResolvedValue({ id: 'pet-1', name: 'Rex', status: PetStatus.EM_PROCESSO });

        await service.update('form-1', { petId: null }, 'org-1');

        expect(tx.form.update).toHaveBeenCalledWith('form-1', { petId: null, updatedBy: null });
        expect(tx.pet.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'pet-1', organizationId: expect.any(String) }), { status: PetStatus.DISPONIVEL, updatedBy: null });
        expect(recordedEvents()[0].description).toBe('Pet Rex desvinculado do termo de adoção');
      });
    });
  });

  describe('resetClause', () => {
    it('volta ao texto original e reinclui a cláusula', async () => {
      const clauses = templateClauses().map((c) => (c.key === 'multa' ? { ...c, content: 'Editada', removed: true } : c));
      contractRepo.findOne.mockResolvedValue(storedContract({ clauses }));

      await service.resetClause('form-1', 'multa', 'org-1', 'user-1');

      const saved = tx.contract.update.mock.calls[0][1].clauses.find((c) => c.key === 'multa');
      expect(saved).toEqual(expect.objectContaining({ removed: false, content: saved.originalContent }));
      expect(recordedEvents().map((e) => e.type)).toEqual([AdoptionHistoryType.CLAUSULA_RESTAURADA, AdoptionHistoryType.CLAUSULA_EDITADA]);
      expect(recordedEvents()[0].metadata.reset).toBe(true);
    });

    it('cláusula inexistente', async () => {
      await expect(service.resetClause('form-1', 'nada', 'org-1')).rejects.toThrow('Cláusula não encontrada.');
    });
  });

  describe('generate', () => {
    it.each([AdoptionFormStatus.PENDENTE, AdoptionFormStatus.REPROVADO])('ficha %s não gera o termo', async (status) => {
      formRepo.findOne.mockResolvedValue(baseForm(status, 'pet-1'));

      await expect(service.generate('form-1', 'org-1')).rejects.toThrow('O termo de adoção só pode ser gerado para fichas aprovadas.');
      expect(buildContractPdf).not.toHaveBeenCalled();
    });

    it('exige o nome do adotante', async () => {
      const data = buildInitialData(baseForm() as any);
      data.adopter.name = '   ';
      contractRepo.findOne.mockResolvedValue(storedContract({ petId: 'pet-1', data }));

      await expect(service.generate('form-1', 'org-1')).rejects.toThrow('Preencha o nome e o CPF do adotante antes de gerar o termo de adoção.');
      expect(storage.uploadPrivate).not.toHaveBeenCalled();
    });

    it('pet sem foto gera o PDF sem imagem', async () => {
      contractRepo.findOne.mockResolvedValue(storedContract({ petId: 'pet-1' }));
      petRepo.findOne.mockResolvedValue({ id: 'pet-1', name: 'Rex', status: PetStatus.EM_PROCESSO, fotos: [] });

      await service.generate('form-1', 'org-1', 'user-1');

      expect(loadImageAsDataUrl).not.toHaveBeenCalled();
      expect((buildContractPdf as jest.Mock).mock.calls[0][0].petPhoto).toBeNull();
      // Pet já reservado: não grava de novo
      expect(tx.pet.update).not.toHaveBeenCalled();
    });

    it('primeira versão grava v1 e cláusulas removidas ficam fora do PDF, com a numeração refeita', async () => {
      const clauses = templateClauses().map((clause) => (clause.key === 'vacina_castracao' ? { ...clause, removed: true } : clause));
      contractRepo.findOne.mockResolvedValue(storedContract({ petId: 'pet-1', clauses }));
      petRepo.findOne.mockResolvedValue({ id: 'pet-1', name: 'Rex', status: PetStatus.EM_PROCESSO, fotos: [] });

      const response = await service.generate('form-1', 'org-1', 'user-1');

      const input = (buildContractPdf as jest.Mock).mock.calls[0][0];
      expect(input.clauses).toHaveLength(CONTRACT_TEMPLATE.length - 1);
      expect(input.clauses.map((clause) => clause.key)).not.toContain('vacina_castracao');
      expect(input.clauses[input.clauses.length - 1].heading).toBe('CLÁUSULA DÉCIMA TERCEIRA');
      expect(input.data).toEqual(expect.objectContaining({ adopter: expect.objectContaining({ name: 'Maria da Silva' }) }));
      expect(storage.uploadPrivate).toHaveBeenCalledWith('contracts/form-1/v1.pdf', expect.any(Buffer), 'application/pdf');
      expect(recordedEvents()[0].metadata).toEqual({ version: 1, storagePath: 'contracts/form-1/v1.pdf', fileName: 'termo-adocao-v1.pdf' });
      expect(response).toBeDefined();
    });

    it('sem data escolhida o termo sai com a data da geração (fuso de Brasília)', async () => {
      jest.useFakeTimers({ now: new Date('2026-10-03T01:30:00Z'), doNotFake: ['nextTick', 'setImmediate'] });
      contractRepo.findOne.mockResolvedValue(storedContract({ petId: 'pet-1' }));
      petRepo.findOne.mockResolvedValue({ id: 'pet-1', name: 'Rex', status: PetStatus.EM_PROCESSO, fotos: [] });

      try {
        await service.generate('form-1', 'org-1', 'user-1');
      } finally {
        jest.useRealTimers();
      }

      // 01:30 UTC ainda é dia 02 em Brasília
      expect((buildContractPdf as jest.Mock).mock.calls[0][0].data.signature).toEqual({ city: 'Curitiba/PR', date: '2026-10-02' });
      // A data não é gravada no rascunho: uma nova versão usa a data do dia em que for gerada
      expect(tx.contract.update.mock.calls[0][1]).not.toHaveProperty('data');
    });

    it('data escolhida no termo é respeitada', async () => {
      const data = buildInitialData(baseForm() as any);
      data.signature.date = '2026-12-25';
      contractRepo.findOne.mockResolvedValue(storedContract({ petId: 'pet-1', data }));
      petRepo.findOne.mockResolvedValue({ id: 'pet-1', name: 'Rex', status: PetStatus.EM_PROCESSO, fotos: [] });

      await service.generate('form-1', 'org-1', 'user-1');

      expect((buildContractPdf as jest.Mock).mock.calls[0][0].data.signature.date).toBe('2026-12-25');
    });

    it('falha ao montar o PDF não grava nada', async () => {
      contractRepo.findOne.mockResolvedValue(storedContract({ petId: 'pet-1' }));
      petRepo.findOne.mockResolvedValue({ id: 'pet-1', name: 'Rex', status: PetStatus.EM_PROCESSO, fotos: [] });
      (buildContractPdf as jest.Mock).mockRejectedValueOnce(new Error('pdfmake'));

      await expect(service.generate('form-1', 'org-1')).rejects.toThrow('pdfmake');
      expect(storage.uploadPrivate).not.toHaveBeenCalled();
      expect(tx.contract.update).not.toHaveBeenCalled();
    });

    it('exige pet vinculado', async () => {
      await expect(service.generate('form-1', 'org-1')).rejects.toThrow('Vincule um pet antes de gerar o termo de adoção.');
    });

    it('exige nome e CPF do adotante', async () => {
      const data = buildInitialData(baseForm() as any);
      data.adopter.cpf = '';
      contractRepo.findOne.mockResolvedValue(storedContract({ petId: 'pet-1', data }));

      await expect(service.generate('form-1', 'org-1')).rejects.toThrow('Preencha o nome e o CPF do adotante antes de gerar o termo de adoção.');
    });

    it('gera o PDF, salva no bucket privado, move a ficha e registra a versão', async () => {
      contractRepo.findOne.mockResolvedValue(storedContract({ petId: 'pet-1', version: 1 }));
      petRepo.findOne.mockResolvedValue({
        id: 'pet-1',
        name: 'Rex',
        status: PetStatus.DISPONIVEL,
        fotos: [
          { url: 'https://p/2.png', createdAt: new Date(2) },
          { url: 'https://p/1.png', createdAt: new Date(1) },
        ],
      });

      await service.generate('form-1', 'org-1', 'user-1');

      expect(loadImageAsDataUrl).toHaveBeenCalledWith('https://p/1.png');
      const input = (buildContractPdf as jest.Mock).mock.calls[0][0];
      expect(input.clauses[0].heading).toBe('CLÁUSULA PRIMEIRA');
      expect(input.petPhoto).toBe('data:image/png;base64,AAAA');
      expect(storage.uploadPrivate).toHaveBeenCalledWith('contracts/form-1/v2.pdf', expect.any(Buffer), 'application/pdf');
      expect(tx.contract.update).toHaveBeenCalledWith('contract-1', {
        version: 2,
        pdfStoragePath: 'contracts/form-1/v2.pdf',
        generatedAt: expect.any(Date),
        adopterSignaturePosition: { page: 4, x: 62.99, y: 30.81 },
        organizationSignaturePosition: { page: 4, x: 10.4, y: 30.81 },
        updatedBy: 'user-1',
      });
      // A ficha continua em Aprovado: o próximo passo é enviar para assinatura
      expect(tx.form.update).not.toHaveBeenCalled();
      expect(tx.pet.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'pet-1', organizationId: expect.any(String) }), { status: PetStatus.EM_PROCESSO, updatedBy: 'user-1' });
      expect(recordedEvents()).toEqual([
        expect.objectContaining({
          type: AdoptionHistoryType.CONTRATO_GERADO,
          description: 'Termo de adoção gerado (versão 2)',
          metadata: { version: 2, storagePath: 'contracts/form-1/v2.pdf', fileName: 'termo-adocao-v2.pdf' },
        }),
      ]);
    });

    it('regerar não muda o status nem o pet já reservado', async () => {
      formRepo.findOne.mockResolvedValue(baseForm(AdoptionFormStatus.APROVADO, 'pet-1'));
      contractRepo.findOne.mockResolvedValue(storedContract({ petId: 'pet-1' }));
      petRepo.findOne.mockResolvedValue({ id: 'pet-1', status: PetStatus.EM_PROCESSO, fotos: [] });

      await service.generate('form-1', 'org-1', 'user-1');

      expect(tx.form.update).not.toHaveBeenCalled();
      expect(tx.pet.update).not.toHaveBeenCalled();
      expect(recordedEvents()[0].toStatus).toBeUndefined();
    });

    it('remove o PDF do bucket se a transação falhar', async () => {
      contractRepo.findOne.mockResolvedValue(storedContract({ petId: 'pet-1' }));
      petRepo.findOne.mockResolvedValue({ id: 'pet-1', status: PetStatus.EM_PROCESSO, fotos: [] });
      tx.contract.update.mockRejectedValue(new Error('banco fora'));

      await expect(service.generate('form-1', 'org-1')).rejects.toThrow('banco fora');
      expect(storage.removePrivate).toHaveBeenCalledWith(['contracts/form-1/v1.pdf']);
    });

    it('adoção concluída não gera novo termo de adoção', async () => {
      formRepo.findOne.mockResolvedValue(baseForm(AdoptionFormStatus.CONCLUIDA, 'pet-1'));

      await expect(service.generate('form-1', 'org-1')).rejects.toThrow('Adoção concluída');
    });

    it('termo aguardando assinatura não pode ser regerado nem editado', async () => {
      formRepo.findOne.mockResolvedValue(baseForm(AdoptionFormStatus.AGUARDANDO_ASSINATURA, 'pet-1'));

      await expect(service.generate('form-1', 'org-1')).rejects.toThrow('já foi enviado para assinatura');
      await expect(service.update('form-1', { data: {} } as any, 'org-1')).rejects.toThrow('já foi enviado para assinatura');
    });
  });

  describe('sendForSignature', () => {
    beforeEach(() => {
      formRepo.findOne.mockResolvedValue(baseForm(AdoptionFormStatus.APROVADO, 'pet-1'));
      contractRepo.findOne.mockResolvedValue(
        storedContract({
          petId: 'pet-1',
          version: 2,
          pdfStoragePath: 'contracts/form-1/v2.pdf',
          adopterSignaturePosition: { page: 4, x: 62.99, y: 30.81 },
          organizationSignaturePosition: { page: 4, x: 10.4, y: 30.81 },
        }),
      );
    });

    it.each([AdoptionFormStatus.PENDENTE, AdoptionFormStatus.AGUARDANDO_ASSINATURA, AdoptionFormStatus.CONCLUIDA])('ficha %s não pode ser enviada', async (status) => {
      formRepo.findOne.mockResolvedValue(baseForm(status, 'pet-1'));

      await expect(service.sendForSignature('form-1', 'org-1')).rejects.toThrow('Só é possível enviar para assinatura o termo de uma ficha aprovada.');
      expect(autentique.createDocument).not.toHaveBeenCalled();
    });

    it('envia o PDF da versão atual, a associação assina na hora e o adotante fica aguardando', async () => {
      await service.sendForSignature('form-1', 'org-1', 'user-1');

      expect(storage.downloadPrivate).toHaveBeenCalledWith('contracts/form-1/v2.pdf');
      expect(autentique.createDocument).toHaveBeenCalledWith({
        name: 'Termo de Adoção - Maria da Silva - v2',
        pdf: Buffer.from('%PDF-v1'),
        fileName: 'termo-de-adocao-v2.pdf',
        signers: [
          { name: 'Júlia Dezordi Ruas', email: 'ong@teste.com', position: { page: 4, x: 10.4, y: 30.81 } },
          { name: 'Maria da Silva', email: 'maria@teste.com', position: { page: 4, x: 62.99, y: 30.81 } },
        ],
      });
      expect(autentique.signDocument).toHaveBeenCalledWith('doc-1');
      expect(tx.contract.update).toHaveBeenCalledWith(
        'contract-1',
        expect.objectContaining({
          autentiqueDocumentId: 'doc-1',
          signatureStatus: 'PENDENTE',
          signatureLink: 'https://assina.ae/abc',
          signatureEmail: 'maria@teste.com',
          signatureVersion: 2,
          signatureSentAt: expect.any(Date),
          signedAt: null,
        }),
      );
      expect(tx.form.update).toHaveBeenCalledWith('form-1', { status: AdoptionFormStatus.AGUARDANDO_ASSINATURA, updatedBy: 'user-1' });
      expect(recordedEvents()).toEqual([
        expect.objectContaining({
          type: AdoptionHistoryType.CONTRATO_ENVIADO_ASSINATURA,
          fromStatus: 'APROVADO',
          toStatus: 'AGUARDANDO_ASSINATURA',
          metadata: { documentId: 'doc-1', version: 2, email: 'maria@teste.com' },
          userName: 'Ana Admin',
        }),
      ]);
    });

    it('exige e-mail do adotante', async () => {
      const contract = storedContract({ petId: 'pet-1', version: 2, pdfStoragePath: 'contracts/form-1/v2.pdf' });
      contract.data.adopter.email = '';
      contractRepo.findOne.mockResolvedValue(contract);
      formRepo.findOne.mockResolvedValue({ ...baseForm(AdoptionFormStatus.APROVADO, 'pet-1'), email: '' });

      await expect(service.sendForSignature('form-1', 'org-1')).rejects.toThrow('Informe o e-mail do adotante');
    });

    it('e-mail do adotante igual ao da conta da associação é recusado', async () => {
      autentique.getAccount.mockResolvedValue({ name: 'ONG', email: 'maria@teste.com' });

      await expect(service.sendForSignature('form-1', 'org-1')).rejects.toThrow('O e-mail do adotante não pode ser o da conta do Autentique da associação.');
      expect(autentique.createDocument).not.toHaveBeenCalled();
    });

    it('falha na assinatura da associação exclui o documento e não muda a ficha', async () => {
      autentique.signDocument.mockRejectedValue(new Error('sem permissão'));

      await expect(service.sendForSignature('form-1', 'org-1')).rejects.toThrow(
        'Não foi possível assinar o termo de adoção pela associação no Autentique. Tente novamente.',
      );
      expect(autentique.deleteDocument).toHaveBeenCalledWith('doc-1');
      expect(tx.form.update).not.toHaveBeenCalled();
    });

    it('termo gerado antes da posição das assinaturas vai sem posição', async () => {
      contractRepo.findOne.mockResolvedValue(storedContract({ petId: 'pet-1', version: 1, pdfStoragePath: 'contracts/form-1/v1.pdf' }));

      await service.sendForSignature('form-1', 'org-1');

      expect(autentique.createDocument.mock.calls[0][0].signers.map((signer) => signer.position)).toEqual([null, null]);
    });

    it('exclui o documento no Autentique se a transação falhar', async () => {
      tx.contract.update.mockRejectedValue(new Error('banco fora'));

      await expect(service.sendForSignature('form-1', 'org-1')).rejects.toThrow('banco fora');
      expect(autentique.deleteDocument).toHaveBeenCalledWith('doc-1');
    });
  });

  describe('sincronização da assinatura', () => {
    beforeEach(() => {
      formRepo.findOne.mockResolvedValue(baseForm(AdoptionFormStatus.AGUARDANDO_ASSINATURA, 'pet-1'));
      contractRepo.findOne.mockResolvedValue(sentContract());
    });

    it('assinado: salva o PDF assinado, conclui a adoção, marca o pet como ADOTADO e registra com o ator Autentique', async () => {
      autentique.getDocument.mockResolvedValue(autentiqueDocument({ signedAt: '2026-10-02T15:00:00.000Z' }));

      await service.syncSignatureByForm('form-1', 'org-1', 'user-1');

      expect(autentique.downloadFile).toHaveBeenCalledWith('https://api.autentique.com.br/documentos/doc-1/assinado.pdf');
      expect(storage.uploadPrivate).toHaveBeenCalledWith('contracts/form-1/assinado-v2.pdf', Buffer.from('%PDF-assinado'), 'application/pdf');
      expect(tx.contract.update).toHaveBeenCalledWith('contract-1', {
        signatureStatus: 'ASSINADO',
        signedAt: new Date('2026-10-02T15:00:00.000Z'),
        signedPdfStoragePath: 'contracts/form-1/assinado-v2.pdf',
      });
      expect(tx.form.update).toHaveBeenCalledWith('form-1', { status: AdoptionFormStatus.CONCLUIDA });
      expect(tx.pet.update).toHaveBeenCalledWith({ id: 'pet-1', organizationId: 'org-1' }, { status: PetStatus.ADOTADO, adoptionDate: expect.any(Date) });
      expect(recordedEvents()).toEqual([
        expect.objectContaining({ type: AdoptionHistoryType.CONTRATO_ASSINADO, userId: null, userName: 'Autentique' }),
        expect.objectContaining({ type: AdoptionHistoryType.ADOCAO_CONCLUIDA, fromStatus: 'AGUARDANDO_ASSINATURA', toStatus: 'CONCLUIDA', userName: 'Autentique' }),
      ]);
    });

    it('recusado: volta para APROVADO e registra ASSINATURA_RECUSADA', async () => {
      autentique.getDocument.mockResolvedValue(autentiqueDocument({ rejectedAt: '2026-10-02T15:00:00.000Z' }));

      await service.syncSignatureByForm('form-1', 'org-1');

      expect(tx.contract.update).toHaveBeenCalledWith('contract-1', { signatureStatus: 'RECUSADO' });
      expect(tx.form.update).toHaveBeenCalledWith('form-1', { status: AdoptionFormStatus.APROVADO });
      expect(recordedEvents()).toEqual([expect.objectContaining({ type: AdoptionHistoryType.ASSINATURA_RECUSADA, toStatus: 'APROVADO' })]);
    });

    it('ainda pendente não grava nada', async () => {
      await service.syncSignatureByForm('form-1', 'org-1');

      expect(tx.contract.update).not.toHaveBeenCalled();
      expect(history.recordMany).not.toHaveBeenCalled();
    });

    it('é idempotente: assinatura já registrada não consulta o Autentique', async () => {
      contractRepo.findOne.mockResolvedValue(sentContract({ signatureStatus: 'ASSINADO' }));

      await service.syncSignatureByForm('form-1', 'org-1');

      expect(autentique.getDocument).not.toHaveBeenCalled();
    });

    it('ficha que voltou para APROVADO só atualiza o termo de adoção', async () => {
      formRepo.findOne.mockResolvedValue(baseForm(AdoptionFormStatus.APROVADO, 'pet-1'));
      autentique.getDocument.mockResolvedValue(autentiqueDocument({ signedAt: '2026-10-02T15:00:00.000Z' }));

      await service.syncSignatureByForm('form-1', 'org-1');

      expect(tx.contract.update).toHaveBeenCalled();
      expect(tx.form.update).not.toHaveBeenCalled();
      expect(tx.pet.update).not.toHaveBeenCalled();
      expect(recordedEvents()).toEqual([expect.objectContaining({ type: AdoptionHistoryType.CONTRATO_ASSINADO })]);
    });

    it('documento que sumiu do Autentique avisa quem clicou em atualizar', async () => {
      autentique.getDocument.mockResolvedValue(null);

      await expect(service.syncSignatureByForm('form-1', 'org-1')).rejects.toThrow(
        'Documento não encontrado no Autentique (excluído ou expirado). Cancele o envio e envie o termo de adoção novamente.',
      );
      expect(tx.contract.update).not.toHaveBeenCalled();
    });

    it('webhook de documento que sumiu do Autentique é ignorado sem erro', async () => {
      autentique.getDocument.mockResolvedValue(null);

      await expect(service.syncSignatureByDocument('doc-1')).resolves.toBe(true);
      expect(tx.contract.update).not.toHaveBeenCalled();
    });

    it('contrato nunca enviado', async () => {
      contractRepo.findOne.mockResolvedValue(storedContract());

      await expect(service.syncSignatureByForm('form-1', 'org-1')).rejects.toThrow('O termo de adoção ainda não foi enviado para assinatura.');
    });

    it('webhook: documento desconhecido é ignorado', async () => {
      contractRepo.findOne.mockResolvedValue(null);

      await expect(service.syncSignatureByDocument('doc-x')).resolves.toBe(false);
      expect(autentique.getDocument).not.toHaveBeenCalled();
    });

    it('webhook: acha o termo de adoção pelo id do documento', async () => {
      autentique.getDocument.mockResolvedValue(autentiqueDocument({ signedAt: '2026-10-02T15:00:00.000Z' }));

      await expect(service.syncSignatureByDocument('doc-1')).resolves.toBe(true);
      expect(contractRepo.findOne).toHaveBeenCalledWith({ where: { autentiqueDocumentId: 'doc-1' } });
      expect(tx.form.update).toHaveBeenCalledWith('form-1', { status: AdoptionFormStatus.CONCLUIDA });
    });
  });

  describe('cancelSignature', () => {
    it('exclui o documento no Autentique e volta para APROVADO', async () => {
      formRepo.findOne.mockResolvedValue(baseForm(AdoptionFormStatus.AGUARDANDO_ASSINATURA, 'pet-1'));
      contractRepo.findOne.mockResolvedValue(sentContract());

      await service.cancelSignature('form-1', 'org-1', 'user-1');

      expect(autentique.deleteDocument).toHaveBeenCalledWith('doc-1');
      expect(tx.contract.update).toHaveBeenCalledWith('contract-1', { signatureStatus: 'CANCELADO', updatedBy: 'user-1' });
      expect(tx.form.update).toHaveBeenCalledWith('form-1', { status: AdoptionFormStatus.APROVADO, updatedBy: 'user-1' });
      expect(recordedEvents()).toEqual([expect.objectContaining({ type: AdoptionHistoryType.ASSINATURA_CANCELADA, toStatus: 'APROVADO' })]);
    });

    it('só cancela termo aguardando assinatura', async () => {
      formRepo.findOne.mockResolvedValue(baseForm(AdoptionFormStatus.CONCLUIDA, 'pet-1'));

      await expect(service.cancelSignature('form-1', 'org-1')).rejects.toThrow(BadRequestException);
      expect(autentique.deleteDocument).not.toHaveBeenCalled();
    });
  });

  describe('resposta', () => {
    it('devolve o resumo da assinatura com a URL assinada do PDF assinado', async () => {
      formRepo.findOne.mockResolvedValue(baseForm(AdoptionFormStatus.CONCLUIDA, 'pet-1'));
      contractRepo.findOne.mockResolvedValue(
        sentContract({ signatureStatus: 'ASSINADO', signatureLink: 'https://assina.ae/abc', signedAt: new Date('2026-10-02'), signedPdfStoragePath: 'contracts/form-1/assinado-v2.pdf' }),
      );

      const contract = await service.findByForm('form-1', 'org-1');

      expect(contract.signature).toEqual(
        expect.objectContaining({
          status: 'ASSINADO',
          email: 'maria@teste.com',
          link: 'https://assina.ae/abc',
          version: 2,
          signedPdfUrl: 'https://signed/contracts/form-1/assinado-v2.pdf',
        }),
      );
    });

    it('nunca enviado devolve signature null', async () => {
      const contract = await service.findByForm('form-1', 'org-1');

      expect(contract.signature).toBeNull();
    });
  });
});
