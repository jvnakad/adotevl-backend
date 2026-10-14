import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AdoptionContract, ContractData } from './adoption-contract.entity';
import { AdoptionForm, AdoptionFormStatus } from '../adoption-form/adoption-form.entity';
import { Pet, PetStatus } from '../pet/pet.entity';
import { StorageService } from '../storage/storage.service';
import { AdoptionHistoryService, RecordHistoryParams } from '../adoption-history/adoption-history.service';
import { AdoptionHistoryType } from '../adoption-history/adoption-history.entity';
import { CONTRACT_TEMPLATE, CONTRACT_TEMPLATE_BY_KEY } from './contract-template';
import { numberClauses, StoredClause, toOrdinalPt, toTitleCase } from './contract-numbering';
import { buildInitialData, diffContractData, prefillAnimalFromPet, sanitizeContractData } from './contract-data';
import { buildContractPdf, loadImageAsDataUrl } from './contract-pdf.builder';
import { ContractClauseDto, UpdateAdoptionContractDto } from './dto/update-adoption-contract.dto';

// Fichas que podem abrir o contrato; CONCLUIDA só leitura
const CONTRACT_VIEW_STATUSES = [AdoptionFormStatus.APROVADO, AdoptionFormStatus.CONTRATO_GERADO, AdoptionFormStatus.CONCLUIDA];
const LINKABLE_PET_STATUSES = [PetStatus.DISPONIVEL, PetStatus.EM_PROCESSO];

type HistoryDraft = Omit<RecordHistoryParams, 'form' | 'userId' | 'userName'>;

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
  constructor(
    @InjectRepository(AdoptionContract)
    private readonly contractRepository: Repository<AdoptionContract>,
    @InjectRepository(AdoptionForm)
    private readonly formRepository: Repository<AdoptionForm>,
    @InjectRepository(Pet)
    private readonly petRepository: Repository<Pet>,
    private readonly storageService: StorageService,
    private readonly historyService: AdoptionHistoryService,
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
          description: `Dados do contrato alterados: ${fields.map((field) => field.label).join(', ')}`,
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
          ? `Pet ${newPet.name} vinculado ao contrato`
          : previousPet
            ? `Pet ${previousPet.name} desvinculado do contrato`
            : 'Pet desvinculado do contrato',
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

  async generate(formId: string, organizationId: string, userId: string = null) {
    const form = await this.getForm(formId, organizationId);
    this.assertEditable(form);
    const contract = await this.ensureContract(form, userId);
    if (!contract.petId) throw new BadRequestException('Vincule um pet antes de gerar o contrato.');
    if (!contract.data?.adopter?.name?.trim() || !contract.data?.adopter?.cpf?.trim()) {
      throw new BadRequestException('Preencha o nome e o CPF do adotante antes de gerar o contrato.');
    }

    const pet = await this.petRepository.findOne({ where: { id: contract.petId }, relations: { fotos: true } });
    const firstPhoto = [...(pet?.fotos ?? [])].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
    const petPhoto = firstPhoto?.url ? await loadImageAsDataUrl(firstPhoto.url) : null;
    const { clauses } = numberClauses(contract.clauses);
    const buffer = await buildContractPdf({ data: contract.data, clauses, petPhoto });

    const version = (contract.version ?? 0) + 1;
    const storagePath = `contracts/${form.id}/v${version}.pdf`;
    await this.storageService.uploadPrivate(storagePath, buffer, 'application/pdf');

    const statusChanged = form.status === AdoptionFormStatus.APROVADO;
    try {
      await this.save(
        form,
        userId,
        [
          {
            type: AdoptionHistoryType.CONTRATO_GERADO,
            description: `Contrato gerado (versão ${version})`,
            fromStatus: statusChanged ? form.status : null,
            toStatus: statusChanged ? AdoptionFormStatus.CONTRATO_GERADO : null,
            metadata: { version, storagePath, fileName: `contrato-v${version}.pdf` },
          },
        ],
        async (manager) => {
          await manager.getRepository(AdoptionContract).update(contract.id, { version, pdfStoragePath: storagePath, generatedAt: new Date(), updatedBy: userId });
          if (statusChanged) {
            await manager.getRepository(AdoptionForm).update(form.id, { status: AdoptionFormStatus.CONTRATO_GERADO, updatedBy: userId });
          }
          if (pet && pet.status !== PetStatus.EM_PROCESSO) {
            await manager.getRepository(Pet).update({ id: pet.id, organizationId: form.organizationId }, { status: PetStatus.EM_PROCESSO, updatedBy: userId });
          }
        },
      );
    } catch (error) {
      // PDF sem registro no banco não deve ficar no bucket
      await this.storageService.removePrivate([storagePath]).catch(() => undefined);
      throw error;
    }
    return this.findByForm(formId, organizationId, userId);
  }

  // Alterações + eventos do histórico na mesma transação
  private async save(form: AdoptionForm, userId: string, events: HistoryDraft[], work: (manager: EntityManager) => Promise<unknown>) {
    const userName = events.length ? await this.historyService.resolveUserName(userId) : undefined;
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
    if (missing.length) errors.push(`Envie todas as cláusulas do contrato. Faltando: ${missing.join(', ')}.`);
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
    const pet = form.petId ? await this.petRepository.findOne({ where: { id: form.petId } }) : null;
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

  private async getForm(id: string, organizationId: string) {
    const form = await this.formRepository.findOne({ where: { id, organizationId, isActive: true } });
    if (!form) throw new NotFoundException('Ficha de adoção não encontrada.');
    return form;
  }

  private assertCanView(form: AdoptionForm) {
    if (!CONTRACT_VIEW_STATUSES.includes(form.status)) {
      throw new BadRequestException('O contrato só pode ser gerado para fichas aprovadas.');
    }
  }

  private assertEditable(form: AdoptionForm) {
    this.assertCanView(form);
    if (form.status === AdoptionFormStatus.CONCLUIDA) {
      throw new BadRequestException('Adoção concluída: o contrato não pode mais ser alterado.');
    }
  }

  private async toResponse(contract: AdoptionContract, form: AdoptionForm) {
    const pet = contract.petId ? await this.petRepository.findOne({ where: { id: contract.petId }, relations: { fotos: true } }) : null;
    const generated = (await this.historyService.findByForm(form.id, form.organizationId)).filter(
      (event) => event.type === AdoptionHistoryType.CONTRATO_GERADO && event.metadata?.storagePath,
    );
    const paths = [...new Set([contract.pdfStoragePath, ...generated.map((event) => event.metadata.storagePath)].filter(Boolean))];
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
      updatedAt: contract.updatedAt,
    };
  }
}
