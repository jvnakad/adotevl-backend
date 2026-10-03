import { BadGatewayException, BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AdoptionContract, ContractData, ContractSignatureStatus } from './adoption-contract.entity';
import { AdoptionForm, AdoptionFormStatus } from '../adoption-form/adoption-form.entity';
import { Pet, PetStatus } from '../pet/pet.entity';
import { StorageService } from '../storage/storage.service';
import { AutentiqueService } from '../autentique/autentique.service';
import { AdoptionHistoryService, RecordHistoryParams } from '../adoption-history/adoption-history.service';
import { AdoptionHistoryType } from '../adoption-history/adoption-history.entity';
import { CONTRACT_TEMPLATE, CONTRACT_TEMPLATE_BY_KEY } from './contract-template';
import { numberClauses, StoredClause, toOrdinalPt, toTitleCase } from './contract-numbering';
import { buildInitialData, diffContractData, prefillAnimalFromPet, sanitizeContractData } from './contract-data';
import { buildContractPdf, loadImageAsDataUrl } from './contract-pdf.builder';
import { ContractClauseDto, UpdateAdoptionContractDto } from './dto/update-adoption-contract.dto';

// Fichas que podem abrir o contrato; a partir do envio para assinatura fica só leitura
const CONTRACT_VIEW_STATUSES = [AdoptionFormStatus.APROVADO, AdoptionFormStatus.AGUARDANDO_ASSINATURA, AdoptionFormStatus.CONCLUIDA];
// Ator dos eventos gravados pelo webhook/sincronização (sem usuário logado)
export const AUTENTIQUE_USER_NAME = 'Autentique';
const LINKABLE_PET_STATUSES = [PetStatus.DISPONIVEL, PetStatus.EM_PROCESSO];

type HistoryDraft = Omit<RecordHistoryParams, 'form' | 'userId' | 'userName'>;

// "YYYY-MM-DD" no fuso de Brasília (o servidor roda em UTC)
const todayInBrazil = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now);

const clauseName = (key: string, number: number | undefined) => {
  const title = CONTRACT_TEMPLATE_BY_KEY[key]?.title ?? key;
  return number ? `Cláusula ${toTitleCase(toOrdinalPt(number))} (${title})` : `Cláusula ${title}`;
};

const templateClauses = (): StoredClause[] =>
  CONTRACT_TEMPLATE.map((clause, index) => ({
    key: clause.key,
    order: index + 1,
    content: clause.content,
    originalContent: clause.content,
    removed: false,
  }));

@Injectable()
export class AdoptionContractService {
  private readonly logger = new Logger(AdoptionContractService.name);

  constructor(
    @InjectRepository(AdoptionContract)
    private readonly contractRepository: Repository<AdoptionContract>,
    @InjectRepository(AdoptionForm)
    private readonly formRepository: Repository<AdoptionForm>,
    @InjectRepository(Pet)
    private readonly petRepository: Repository<Pet>,
    private readonly storageService: StorageService,
    private readonly historyService: AdoptionHistoryService,
    private readonly autentiqueService: AutentiqueService,
  ) {}

  // Cria o rascunho a partir do modelo na primeira abertura
  async findByForm(formId: string, organizationId: string, userId: string = null) {
    const form = await this.getForm(formId, organizationId);
    this.assertCanView(form);
    const contract = await this.ensureContract(form, userId);
    return this.toResponse(contract, form);
  }

  async update(formId: string, dto: UpdateAdoptionContractDto, organizationId: string, userId: string = null) {
    const form = await this.getForm(formId, organizationId);
    this.assertEditable(form);
    const contract = await this.ensureContract(form, userId);
    const events: HistoryDraft[] = [];

    let data = contract.data;
    if (dto.data !== undefined) {
      const { data: next, errors } = sanitizeContractData(dto.data, contract.data);
      if (errors.length) throw new BadRequestException(errors);
      const fields = diffContractData(contract.data, next);
      if (fields.length) {
        events.push({
          type: AdoptionHistoryType.CONTRATO_DADOS_ALTERADOS,
          description: `Dados do termo de adoção alterados: ${fields.map((field) => field.label).join(', ')}`,
          metadata: { fields },
        });
      }
      data = next;
    }

    let clauses = contract.clauses;
    if (dto.clauses !== undefined) {
      clauses = this.validateClauses(dto.clauses);
      events.push(...this.diffClauses(contract.clauses, clauses));
    }

    // Troca de pet: o novo fica EM_PROCESSO e o anterior volta a DISPONIVEL
    const currentPetId = contract.petId ?? null;
    const nextPetId = dto.petId === undefined ? currentPetId : dto.petId ?? null;
    let newPet: Pet = null;
    let previousPet: Pet = null;
    const petChanged = nextPetId !== currentPetId;
    if (petChanged) {
      if (nextPetId) newPet = await this.getLinkablePet(nextPetId, organizationId);
      if (currentPetId) previousPet = await this.petRepository.findOne({ where: { id: currentPetId } });
      if (newPet) data = prefillAnimalFromPet(data, newPet);
      events.push({
        type: AdoptionHistoryType.PET_VINCULADO,
        description: newPet
          ? `Pet ${newPet.name} vinculado ao termo de adoção`
          : previousPet
            ? `Pet ${previousPet.name} desvinculado do termo de adoção`
            : 'Pet desvinculado do termo de adoção',
        metadata: {
          before: previousPet ? { id: previousPet.id, name: previousPet.name } : null,
          after: newPet ? { id: newPet.id, name: newPet.name } : null,
        },
      });
    }

    await this.save(form, userId, events, async (manager) => {
      await manager.getRepository(AdoptionContract).update(contract.id, { data, clauses, petId: nextPetId, updatedBy: userId });
      if (petChanged) {
        await manager.getRepository(AdoptionForm).update(form.id, { petId: nextPetId, updatedBy: userId });
        const pets = manager.getRepository(Pet);
        if (previousPet?.status === PetStatus.EM_PROCESSO) await pets.update({ id: previousPet.id, organizationId: form.organizationId }, { status: PetStatus.DISPONIVEL, updatedBy: userId });
        if (newPet) await pets.update({ id: newPet.id, organizationId: form.organizationId }, { status: PetStatus.EM_PROCESSO, updatedBy: userId });
      }
    });
    return this.findByForm(formId, organizationId, userId);
  }

  // Volta a cláusula ao texto do modelo e a reinclui no contrato
  async resetClause(formId: string, key: string, organizationId: string, userId: string = null) {
    const form = await this.getForm(formId, organizationId);
    this.assertEditable(form);
    const contract = await this.ensureContract(form, userId);
    if (!contract.clauses.some((clause) => clause.key === key)) throw new NotFoundException('Cláusula não encontrada.');

    const clauses = contract.clauses.map((clause) =>
      clause.key === key ? { ...clause, content: clause.originalContent, removed: false } : clause,
    );
    const events = this.diffClauses(contract.clauses, clauses).map((event) => ({ ...event, metadata: { ...event.metadata, reset: true } }));

    await this.save(form, userId, events, (manager) =>
      manager.getRepository(AdoptionContract).update(contract.id, { clauses, updatedBy: userId }),
    );
    return this.findByForm(formId, organizationId, userId);
  }

  // Gera a nova versão do PDF e já envia ao Autentique: a associação assina na hora (conta do token, linha
  // "Representante legal"), o adotante recebe o link por e-mail e a ficha vai para Aguardando assinatura.
  // Com um envio pendente, a versão anterior é cancelada no Autentique.
  async generate(formId: string, organizationId: string, userId: string = null) {
    const form = await this.getForm(formId, organizationId);
    this.assertEditable(form);
    const contract = await this.ensureContract(form, userId);
    if (!contract.petId) throw new BadRequestException('Vincule um pet antes de gerar o termo de adoção.');
    if (!contract.data?.adopter?.name?.trim() || !contract.data?.adopter?.cpf?.trim()) {
      throw new BadRequestException('Preencha o nome e o CPF do adotante antes de gerar o termo de adoção.');
    }
    const name = contract.data.adopter.name.trim();
    const email = (contract.data.adopter.email?.trim() || form.email)?.toLowerCase();
    if (!email) throw new BadRequestException('Informe o e-mail do adotante antes de gerar o termo de adoção.');
    const organization = await this.autentiqueService.getAccount();
    if (email === organization.email) {
      throw new BadRequestException('O e-mail do adotante não pode ser o da conta do Autentique da associação.');
    }

    const pet = await this.petRepository.findOne({ where: { id: contract.petId }, relations: { fotos: true } });
    const firstPhoto = [...(pet?.fotos ?? [])].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
    const petPhoto = firstPhoto?.url ? await loadImageAsDataUrl(firstPhoto.url) : null;
    const { clauses } = numberClauses(contract.clauses);
    // Sem data escolhida, o termo sai com a data da geração
    const data = contract.data.signature?.date ? contract.data : { ...contract.data, signature: { ...contract.data.signature, date: todayInBrazil() } };
    const { buffer, adopterSignature, organizationSignature } = await buildContractPdf({ data, clauses, petPhoto });

    const version = (contract.version ?? 0) + 1;
    const storagePath = `contracts/${form.id}/v${version}.pdf`;
    await this.storageService.uploadPrivate(storagePath, buffer, 'application/pdf');

    let documentId: string = null;
    try {
      const document = await this.autentiqueService.createDocument({
        name: `Termo de Adoção - ${name} - v${version}`,
        pdf: buffer,
        fileName: `termo-de-adocao-v${version}.pdf`,
        signers: [
          { name: organization.name, email: organization.email, position: organizationSignature },
          { name, email, position: adopterSignature },
        ],
      });
      documentId = document.id;
      try {
        await this.autentiqueService.signDocument(document.id);
      } catch (error) {
        this.logger.error(`Falha ao assinar o documento ${document.id} pela associação: ${error?.message}`);
        throw new BadGatewayException('Não foi possível assinar o termo de adoção pela associação no Autentique. Tente novamente.');
      }
      // A lista também traz a associação: o adotante é achado pelo e-mail
      const signature = document.signatures.find((item) => item.email === email);

      const previousDocumentId = contract.signatureStatus === ContractSignatureStatus.PENDENTE ? contract.autentiqueDocumentId : null;
      const statusChanged = form.status !== AdoptionFormStatus.AGUARDANDO_ASSINATURA;
      await this.save(
        form,
        userId,
        [
          ...(previousDocumentId
            ? [
                {
                  type: AdoptionHistoryType.ASSINATURA_CANCELADA,
                  description: `Envio da versão ${contract.signatureVersion} cancelado: substituída pela versão ${version}`,
                  metadata: { documentId: previousDocumentId, version: contract.signatureVersion, replacedBy: version },
                },
              ]
            : []),
          {
            type: AdoptionHistoryType.CONTRATO_GERADO,
            description: `Termo de adoção gerado (versão ${version})`,
            metadata: { version, storagePath, fileName: `termo-adocao-v${version}.pdf` },
          },
          {
            type: AdoptionHistoryType.CONTRATO_ENVIADO_ASSINATURA,
            description: `Termo de adoção (versão ${version}) enviado para assinatura de ${email}`,
            fromStatus: statusChanged ? form.status : null,
            toStatus: statusChanged ? AdoptionFormStatus.AGUARDANDO_ASSINATURA : null,
            metadata: { documentId: document.id, version, email },
          },
        ],
        async (manager) => {
          await manager.getRepository(AdoptionContract).update(contract.id, {
            version,
            pdfStoragePath: storagePath,
            generatedAt: new Date(),
            adopterSignaturePosition: adopterSignature,
            organizationSignaturePosition: organizationSignature,
            autentiqueDocumentId: document.id,
            signatureStatus: ContractSignatureStatus.PENDENTE,
            signatureLink: signature?.link ?? null,
            signatureEmail: email,
            signatureVersion: version,
            signatureSentAt: new Date(),
            signedAt: null,
            signedPdfStoragePath: null,
            updatedBy: userId,
          });
          if (statusChanged) {
            await manager.getRepository(AdoptionForm).update(form.id, { status: AdoptionFormStatus.AGUARDANDO_ASSINATURA, updatedBy: userId });
          }
          if (pet && pet.status !== PetStatus.EM_PROCESSO) {
            await manager.getRepository(Pet).update({ id: pet.id, organizationId: form.organizationId }, { status: PetStatus.EM_PROCESSO, updatedBy: userId });
          }
        },
      );

      // Versão anterior só sai do Autentique depois que a nova está gravada
      if (previousDocumentId) {
        await this.autentiqueService.deleteDocument(previousDocumentId).catch((error) => {
          this.logger.warn(`Não foi possível excluir a versão anterior ${previousDocumentId} no Autentique: ${error?.message}`);
        });
      }
    } catch (error) {
      // Nada fica pela metade: sem registro no banco, o PDF sai do bucket e o documento novo do Autentique
      await this.storageService.removePrivate([storagePath]).catch(() => undefined);
      if (documentId) await this.autentiqueService.deleteDocument(documentId).catch(() => undefined);
      throw error;
    }
    return this.findByForm(formId, organizationId, userId);
  }

  // Botão "Atualizar status" do front (alternativa ao webhook)
  async syncSignatureByForm(formId: string, organizationId: string, userId: string = null) {
    const form = await this.getForm(formId, organizationId);
    this.assertCanView(form);
    const contract = await this.contractRepository.findOne({ where: { adoptionFormId: form.id } });
    if (!contract?.autentiqueDocumentId) throw new BadRequestException('O termo de adoção ainda não foi enviado para assinatura.');
    // No webhook o documento sumido só é ignorado; aqui quem clicou precisa saber o que fazer
    if ((await this.syncSignature(contract, form)) === 'not_found') {
      throw new NotFoundException('Documento não encontrado no Autentique (excluído ou expirado). Cancele o envio e envie o termo de adoção novamente.');
    }
    return this.findByForm(formId, organizationId, userId);
  }

  // Webhook: o payload só diz qual documento mudou; o estado vem sempre da consulta ao Autentique
  async syncSignatureByDocument(documentId: string) {
    const contract = await this.contractRepository.findOne({ where: { autentiqueDocumentId: documentId } });
    if (!contract) return false;
    const form = await this.formRepository.findOne({ where: { id: contract.adoptionFormId, isActive: true } });
    if (!form) return false;
    await this.syncSignature(contract, form);
    return true;
  }

  // Idempotente: só age enquanto a assinatura está pendente
  private async syncSignature(contract: AdoptionContract, form: AdoptionForm): Promise<'not_found' | void> {
    if (contract.signatureStatus !== ContractSignatureStatus.PENDENTE) return;
    const document = await this.autentiqueService.getDocument(contract.autentiqueDocumentId);
    if (!document) {
      this.logger.warn(`Documento ${contract.autentiqueDocumentId} não encontrado no Autentique.`);
      return 'not_found';
    }
    const signature = document.signatures.find((item) => item.email === contract.signatureEmail);
    if (!signature) return;
    // A ficha pode ter voltado para Aprovado (ADMIN) enquanto aguardava: aí só o termo é atualizado
    const waiting = form.status === AdoptionFormStatus.AGUARDANDO_ASSINATURA;

    if (signature.signedAt) {
      let signedPdfStoragePath: string = null;
      if (document.signedFileUrl) {
        const storagePath = `contracts/${form.id}/assinado-v${contract.signatureVersion}.pdf`;
        const pdf = await this.autentiqueService.downloadFile(document.signedFileUrl);
        // Upload não sobrescreve: remove sobra de uma sincronização anterior que falhou no meio
        await this.storageService.removePrivate([storagePath]).catch(() => undefined);
        await this.storageService.uploadPrivate(storagePath, pdf, 'application/pdf');
        signedPdfStoragePath = storagePath;
      }
      await this.save(
        form,
        null,
        [
          {
            type: AdoptionHistoryType.CONTRATO_ASSINADO,
            description: `Termo de adoção (versão ${contract.signatureVersion}) assinado por ${signature.name ?? contract.signatureEmail}`,
            metadata: { documentId: document.id, version: contract.signatureVersion, signedAt: signature.signedAt, storagePath: signedPdfStoragePath },
          },
          // Assinatura conclui a adoção sozinha
          ...(waiting
            ? [
                {
                  type: AdoptionHistoryType.ADOCAO_CONCLUIDA,
                  description: 'Adoção concluída',
                  fromStatus: form.status,
                  toStatus: AdoptionFormStatus.CONCLUIDA,
                  metadata: { petId: contract.petId ?? null },
                },
              ]
            : []),
        ],
        async (manager) => {
          await manager.getRepository(AdoptionContract).update(contract.id, {
            signatureStatus: ContractSignatureStatus.ASSINADO,
            signedAt: new Date(signature.signedAt),
            signedPdfStoragePath,
          });
          if (!waiting) return;
          await manager.getRepository(AdoptionForm).update(form.id, { status: AdoptionFormStatus.CONCLUIDA });
          if (contract.petId) {
            await manager.getRepository(Pet).update({ id: contract.petId, organizationId: form.organizationId }, { status: PetStatus.ADOTADO, adoptionDate: new Date() });
          }
        },
        AUTENTIQUE_USER_NAME,
      );
      return;
    }

    if (signature.rejectedAt) {
      await this.save(
        form,
        null,
        [
          {
            type: AdoptionHistoryType.ASSINATURA_RECUSADA,
            description: `Assinatura do termo de adoção recusada por ${signature.name ?? contract.signatureEmail}`,
            fromStatus: waiting ? form.status : null,
            toStatus: waiting ? AdoptionFormStatus.APROVADO : null,
            metadata: { documentId: document.id, version: contract.signatureVersion, rejectedAt: signature.rejectedAt },
          },
        ],
        async (manager) => {
          await manager.getRepository(AdoptionContract).update(contract.id, { signatureStatus: ContractSignatureStatus.RECUSADO });
          if (waiting) await manager.getRepository(AdoptionForm).update(form.id, { status: AdoptionFormStatus.APROVADO });
        },
        AUTENTIQUE_USER_NAME,
      );
    }
  }

  // Cancela o envio (ADMIN): exclui o documento no Autentique e a ficha volta para Aprovado
  async cancelSignature(formId: string, organizationId: string, userId: string = null) {
    const form = await this.getForm(formId, organizationId);
    if (form.status !== AdoptionFormStatus.AGUARDANDO_ASSINATURA) {
      throw new BadRequestException('Só é possível cancelar um termo de adoção aguardando assinatura.');
    }
    const contract = await this.contractRepository.findOne({ where: { adoptionFormId: form.id } });
    if (contract?.autentiqueDocumentId) await this.autentiqueService.deleteDocument(contract.autentiqueDocumentId);

    await this.save(
      form,
      userId,
      [
        {
          type: AdoptionHistoryType.ASSINATURA_CANCELADA,
          description: 'Envio do termo de adoção para assinatura cancelado',
          fromStatus: form.status,
          toStatus: AdoptionFormStatus.APROVADO,
          metadata: { documentId: contract?.autentiqueDocumentId ?? null, version: contract?.signatureVersion ?? null },
        },
      ],
      async (manager) => {
        if (contract) await manager.getRepository(AdoptionContract).update(contract.id, { signatureStatus: ContractSignatureStatus.CANCELADO, updatedBy: userId });
        await manager.getRepository(AdoptionForm).update(form.id, { status: AdoptionFormStatus.APROVADO, updatedBy: userId });
      },
    );
    return this.findByForm(formId, organizationId, userId);
  }

  // Alterações + eventos do histórico na mesma transação; fixedUserName para ações sem usuário (Autentique)
  private async save(form: AdoptionForm, userId: string, events: HistoryDraft[], work: (manager: EntityManager) => Promise<unknown>, fixedUserName?: string) {
    const userName = events.length ? fixedUserName ?? (await this.historyService.resolveUserName(userId)) : undefined;
    await this.contractRepository.manager.transaction(async (manager) => {
      await work(manager);
      await this.historyService.recordMany(
        events.map((event) => ({ ...event, form, userId, userName })),
        manager,
      );
    });
  }

  // Lista completa: todas as chaves do modelo, sem repetidas, sem remover a cláusula travada
  private validateClauses(input: ContractClauseDto[]): StoredClause[] {
    const errors: string[] = [];
    const seen = new Set<string>();

    for (const clause of input) {
      const template = CONTRACT_TEMPLATE_BY_KEY[clause.key];
      if (!template) {
        errors.push(`Cláusula desconhecida: ${clause.key}.`);
        continue;
      }
      if (seen.has(clause.key)) errors.push(`Cláusula repetida: ${clause.key}.`);
      seen.add(clause.key);
      if (template.locked && clause.removed) errors.push(`A cláusula "${template.title}" não pode ser removida.`);
      if (!clause.removed && !clause.content?.trim()) errors.push(`O texto da cláusula "${template.title}" não pode ficar vazio.`);
    }
    const missing = CONTRACT_TEMPLATE.filter((clause) => !seen.has(clause.key)).map((clause) => clause.key);
    if (missing.length) errors.push(`Envie todas as cláusulas do termo de adoção. Faltando: ${missing.join(', ')}.`);
    if (errors.length) throw new BadRequestException(errors);

    const templateIndex = (key: string) => CONTRACT_TEMPLATE.findIndex((clause) => clause.key === key);
    return [...input]
      .sort((a, b) => a.order - b.order || templateIndex(a.key) - templateIndex(b.key))
      .map((clause, index) => ({
        key: clause.key,
        order: index + 1,
        content: clause.content.replace(/\r\n/g, '\n').trim() || CONTRACT_TEMPLATE_BY_KEY[clause.key].content,
        originalContent: CONTRACT_TEMPLATE_BY_KEY[clause.key].content,
        removed: clause.removed,
      }));
  }

  // Um evento por cláusula alterada, com o número que ela tinha/tem para exibir
  private diffClauses(before: StoredClause[], after: StoredClause[]): HistoryDraft[] {
    const numbersBefore = new Map(numberClauses(before).clauses.map((clause) => [clause.key, clause.number]));
    const numbersAfter = new Map(numberClauses(after).clauses.map((clause) => [clause.key, clause.number]));
    const events: HistoryDraft[] = [];

    for (const next of after) {
      const previous = before.find((clause) => clause.key === next.key);
      if (!previous) continue;
      const base = { clauseKey: next.key, clauseTitle: CONTRACT_TEMPLATE_BY_KEY[next.key]?.title ?? next.key };

      if (!previous.removed && next.removed) {
        const clauseNumber = numbersBefore.get(next.key);
        events.push({
          type: AdoptionHistoryType.CLAUSULA_REMOVIDA,
          description: `${clauseName(next.key, clauseNumber)} removida`,
          metadata: { ...base, clauseNumber, before: previous.content, after: null },
        });
        continue;
      }
      if (next.removed) continue;

      const clauseNumber = numbersAfter.get(next.key);
      if (previous.removed) {
        events.push({
          type: AdoptionHistoryType.CLAUSULA_RESTAURADA,
          description: `${clauseName(next.key, clauseNumber)} restaurada`,
          metadata: { ...base, clauseNumber, before: null, after: next.content },
        });
      }
      if (previous.content !== next.content) {
        events.push({
          type: AdoptionHistoryType.CLAUSULA_EDITADA,
          description: `${clauseName(next.key, clauseNumber)} editada`,
          metadata: { ...base, clauseNumber, before: previous.content, after: next.content },
        });
      }
    }
    return events;
  }

  private async getLinkablePet(petId: string, organizationId: string) {
    const pet = await this.petRepository.findOne({ where: { id: petId, organizationId, isActive: true } });
    if (!pet) throw new NotFoundException('Pet não encontrado.');
    if (pet.status && !LINKABLE_PET_STATUSES.includes(pet.status)) {
      throw new BadRequestException('O pet selecionado não está disponível para adoção.');
    }
    return pet;
  }

  private async ensureContract(form: AdoptionForm, userId: string) {
    const existing = await this.contractRepository.findOne({ where: { adoptionFormId: form.id } });
    if (existing) return existing;
    // Sem pet vinculado, os dados do animal vêm do pet escolhido no formulário (ainda sem reservar)
    const pet = form.petId ? await this.petRepository.findOne({ where: { id: form.petId } }) : await this.getSuggestedPet(form);
    const contract = this.contractRepository.create({
      adoptionFormId: form.id,
      organizationId: form.organizationId,
      petId: form.petId ?? null,
      data: buildInitialData(form, pet),
      clauses: templateClauses(),
      version: 0,
      createdBy: userId,
      updatedBy: userId,
    });
    return this.contractRepository.save(contract);
  }

  // Pet escolhido pelo adotante no formulário, se ainda puder ser vinculado ao termo
  private async getSuggestedPet(form: AdoptionForm) {
    if (!form.desiredPetId) return null;
    const pet = await this.petRepository.findOne({ where: { id: form.desiredPetId, organizationId: form.organizationId, isActive: true } });
    return pet && LINKABLE_PET_STATUSES.includes(pet.status) ? pet : null;
  }

  private async getForm(id: string, organizationId: string) {
    const form = await this.formRepository.findOne({ where: { id, organizationId, isActive: true } });
    if (!form) throw new NotFoundException('Ficha de adoção não encontrada.');
    return form;
  }

  private assertCanView(form: AdoptionForm) {
    if (!CONTRACT_VIEW_STATUSES.includes(form.status)) {
      throw new BadRequestException('O termo de adoção só pode ser gerado para fichas aprovadas.');
    }
  }

  private assertEditable(form: AdoptionForm) {
    this.assertCanView(form);
    if (form.status === AdoptionFormStatus.CONCLUIDA) {
      throw new BadRequestException('Adoção concluída: o termo de adoção não pode mais ser alterado.');
    }
  }

  private async toResponse(contract: AdoptionContract, form: AdoptionForm) {
    const pet = contract.petId ? await this.petRepository.findOne({ where: { id: contract.petId }, relations: { fotos: true } }) : null;
    const generated = (await this.historyService.findByForm(form.id, form.organizationId)).filter(
      (event) => event.type === AdoptionHistoryType.CONTRATO_GERADO && event.metadata?.storagePath,
    );
    const paths = [...new Set([contract.pdfStoragePath, contract.signedPdfStoragePath, ...generated.map((event) => event.metadata.storagePath)].filter(Boolean))];
    const signed = await this.storageService.getSignedUrls(paths);

    const clauses = [...contract.clauses]
      .sort((a, b) => a.order - b.order)
      .map((clause) => ({ ...clause, locked: !!CONTRACT_TEMPLATE_BY_KEY[clause.key]?.locked }));
    const fotos = [...(pet?.fotos ?? [])].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    return {
      id: contract.id,
      adoptionFormId: contract.adoptionFormId,
      petId: contract.petId ?? null,
      pet: pet ? { id: pet.id, name: pet.name, species: pet.species, fotos: fotos.map((foto) => ({ url: foto.url })) } : null,
      data: contract.data as ContractData,
      clauses,
      version: contract.version ?? 0,
      pdfUrl: contract.pdfStoragePath ? signed[contract.pdfStoragePath] ?? null : null,
      generatedAt: contract.generatedAt ?? null,
      versions: generated.map((event) => ({
        version: event.metadata.version,
        generatedAt: event.createdAt,
        url: signed[event.metadata.storagePath] ?? null,
        userName: event.userName,
      })),
      // O front pré-seleciona este pet no rascunho; ao salvar, ele é vinculado e reservado
      suggestedPetId: contract.petId ? null : (await this.getSuggestedPet(form))?.id ?? null,
      signature: contract.signatureStatus
        ? {
            status: contract.signatureStatus,
            email: contract.signatureEmail ?? null,
            link: contract.signatureLink ?? null,
            version: contract.signatureVersion ?? null,
            sentAt: contract.signatureSentAt ?? null,
            signedAt: contract.signedAt ?? null,
            signedPdfUrl: contract.signedPdfStoragePath ? signed[contract.signedPdfStoragePath] ?? null : null,
          }
        : null,
      updatedAt: contract.updatedAt,
    };
  }
}
