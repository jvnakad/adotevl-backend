import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike, FindOptionsWhere } from 'typeorm';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import { AdoptionForm, AdoptionFormStatus, ADOPTION_FORM_STATUS_LABELS, ADOPTION_FORM_STATUS_ORDER } from './adoption-form.entity';
import { AdoptionFormPhoto } from './adoption-form-photo.entity';
import { ADOPTION_FORM_FIELD_LABELS } from './adoption-form-labels';
import { dateOnly } from '../adoption-contract/contract-data';
import { Organization } from '../organization/organization.entity';
import { Pet, PetStatus } from '../pet/pet.entity';
import { CreateAdoptionFormDto } from './dto/create-adoption-form.dto';
import { UpdateAdoptionFormDto } from './dto/update-adoption-form.dto';
import { UpdateAdoptionFormStatusDto } from './dto/update-adoption-form-status.dto';
import { PaginationDto } from '../common/pagination.dto';
import { paginate } from '../common/paginate.helper';
import { StorageService } from '../storage/storage.service';
import { AdoptionHistoryService } from '../adoption-history/adoption-history.service';
import { AdoptionHistoryType } from '../adoption-history/adoption-history.entity';
import { AdoptionContract, ContractSignatureStatus } from '../adoption-contract/adoption-contract.entity';
import { AutentiqueService } from '../autentique/autentique.service';

export const MAX_ADOPTION_FORM_PHOTOS = 6;
export const MAX_ADOPTION_PHOTO_SIZE = 5 * 1024 * 1024;
export const BOARD_COLUMN_LIMIT = 50;
const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Status "livres" do kanban: qualquer um pode ir para qualquer outro
const REVIEW_STATUSES = [AdoptionFormStatus.PENDENTE, AdoptionFormStatus.APROVADO, AdoptionFormStatus.REPROVADO];
// Status com contrato: só voltam para APROVADO (ADMIN)
const CONTRACT_STATUSES = [AdoptionFormStatus.AGUARDANDO_ASSINATURA, AdoptionFormStatus.CONCLUIDA];
// Só mudam pelo fluxo de assinatura: envio ao Autentique e assinatura (que conclui a adoção)
const SIGNATURE_STATUSES = [AdoptionFormStatus.AGUARDANDO_ASSINATURA, AdoptionFormStatus.CONCLUIDA];
// Saindo destes status para PENDENTE/REPROVADO o pet vinculado volta a ficar disponível
const PET_RESERVED_STATUSES = [AdoptionFormStatus.APROVADO];
const PET_RELEASE_TARGETS = [AdoptionFormStatus.PENDENTE, AdoptionFormStatus.REPROVADO];

// "YYYY-MM-DD" -> Date à meia-noite local: o TypeORM grava colunas "date" com o dia local,
// então new Date('YYYY-MM-DD') (meia-noite UTC) gravaria o dia anterior em servidores UTC-3
const localDate = (value: string) => {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day);
};

const statusLabel =(status: AdoptionFormStatus) => ADOPTION_FORM_STATUS_LABELS[status] ?? status;

// Normaliza valores para comparar antes/depois (datas do Postgres chegam como string ou Date)
const comparable = (value: unknown) => {
  if (value === undefined || value === '') return null;
  if (value instanceof Date) return dateOnly(value) || null;
  return value;
};

// Resposta "filha" -> condição para ela ser exibida no formulário. Fora da condição, é limpa.
const CONDITIONAL_ANSWERS: { field: keyof AdoptionForm; visible: (f: AdoptionForm) => boolean; message: string }[] = [
  { field: 'petsDescription', visible: (f) => f.hasPets === 'yes', message: 'Descreva quais animais você tem.' },
  { field: 'petsNeutered', visible: (f) => f.hasPets === 'yes', message: 'Informe se seus animais são castrados.' },
  { field: 'petsNotNeuteredReason', visible: (f) => f.hasPets === 'yes' && f.petsNeutered === 'no', message: 'Explique por que seus animais não são castrados.' },
  { field: 'sawAdOnOther', visible: (f) => f.sawAdOn === 'other', message: 'Informe onde viu a divulgação.' },
  { field: 'trustedClinicName', visible: (f) => f.hasTrustedClinic === 'yes', message: 'Informe o nome da clínica de confiança.' },
  { field: 'condoPetPolicy', visible: (f) => f.residenceType === 'apartment', message: 'Informe a posição do condomínio sobre animais.' },
  { field: 'housingOwnershipOther', visible: (f) => f.housingOwnership === 'other', message: 'Descreva o tipo de imóvel.' },
  { field: 'childrenAges', visible: (f) => f.childrenCount > 0, message: 'Informe a idade das crianças.' },
  { field: 'moveAnimalPlan', visible: (f) => ['yes', 'maybe'].includes(f.plansToMove), message: 'Informe o que fará com o animal na mudança.' },
  { field: 'surrenderDetails', visible: (f) => f.hasSurrenderedPet === 'yes', message: 'Descreva as circunstâncias da doação.' },
  { field: 'lostPetDetails', visible: (f) => f.hasLostPetOutside === 'yes', message: 'Descreva as circunstâncias da perda.' },
  { field: 'recentDeathDetails', visible: (f) => f.hadRecentPetDeath === 'yes', message: 'Detalhe as circunstâncias da morte.' },
];

@Injectable()
export class AdoptionFormService implements OnModuleInit {
  private readonly logger = new Logger(AdoptionFormService.name);

  constructor(
    @InjectRepository(AdoptionForm)
    private readonly formRepository: Repository<AdoptionForm>,
    @InjectRepository(AdoptionFormPhoto)
    private readonly photoRepository: Repository<AdoptionFormPhoto>,
    @InjectRepository(Organization)
    private readonly organizationRepository: Repository<Organization>,
    @InjectRepository(Pet)
    private readonly petRepository: Repository<Pet>,
    private readonly storageService: StorageService,
    private readonly historyService: AdoptionHistoryService,
    @InjectRepository(AdoptionContract)
    private readonly contractRepository: Repository<AdoptionContract>,
    private readonly autentiqueService: AutentiqueService,
  ) {}

  // Status que saíram do fluxo: "Em análise" volta para Pendente e "Termo gerado" para Aprovado
  async onModuleInit() {
    const legacy = [
      { from: AdoptionFormStatus.EM_ANALISE, to: AdoptionFormStatus.PENDENTE },
      { from: AdoptionFormStatus.CONTRATO_GERADO, to: AdoptionFormStatus.APROVADO },
    ];
    for (const { from, to } of legacy) {
      const { affected } = await this.formRepository.update({ status: from }, { status: to });
      if (affected) this.logger.log(`${affected} ficha(s) em ${statusLabel(from)} movida(s) para ${statusLabel(to)}.`);
    }
  }

  // Rota pública: não devolve os dados pessoais enviados, só a confirmação
  async create(dto: CreateAdoptionFormDto, files: Express.Multer.File[]) {
    if (!files?.length) throw new BadRequestException('Envie pelo menos uma foto da residência no campo "photos".');
    this.validatePhotoTypes(files);

    const organization = await this.organizationRepository.findOne({ where: { id: dto.organizationId, isActive: true } });
    if (!organization) throw new BadRequestException('Organização não encontrada.');

    const form = this.formRepository.create({ ...dto, birthDate: localDate(dto.birthDate), state: dto.state.toUpperCase() });
    if (dto.desiredPetId) {
      // O pet pode ter sido adotado entre abrir o formulário e enviar
      const pet = await this.petRepository.findOne({ where: { id: dto.desiredPetId, organizationId: dto.organizationId, isActive: true } });
      if (!pet || pet.status !== PetStatus.DISPONIVEL) {
        throw new BadRequestException('O animal escolhido não está mais disponível para adoção. Escolha outro.');
      }
      form.desiredAnimal = pet.name;
    }
    this.normalizeAnswers(form);

    const saved = await this.formRepository.save(form);
    try {
      await this.uploadPhotos(saved.id, files);
    } catch (error) {
      await this.formRepository.delete(saved.id);
      throw error;
    }

    await this.historyService.record({
      form: saved,
      type: AdoptionHistoryType.FICHA_CRIADA,
      toStatus: saved.status,
      description: 'Ficha enviada pelo formulário público',
    });

    return {
      id: saved.id,
      status: saved.status,
      createdAt: saved.createdAt,
      message: 'Ficha de adoção enviada com sucesso.',
    };
  }

  async findAll(pagination: PaginationDto, organizationId: string, filters: { status?: string; search?: string } = {}) {
    const base: FindOptionsWhere<AdoptionForm> = { organizationId, isActive: true };
    if (filters.status) base.status = filters.status as AdoptionFormStatus;
    const where = this.searchWhere(base, filters.search);

    const result = await paginate(this.formRepository, pagination, where, { fotos: true }, { createdAt: 'DESC' });
    result.data.forEach((form) => this.sortPhotos(form));
    await this.signPhotoUrls(result.data);
    return result;
  }

  async findOne(id: string, organizationId: string) {
    const form = await this.getForm(id, organizationId, true);
    await this.signPhotoUrls([form]);
    return { ...form, pet: this.petSummary(form.pet), desiredPet: this.petSummary(form.desiredPet) };
  }

  // Kanban: todas as colunas sempre presentes, até 50 fichas resumidas por coluna
  async board(organizationId: string, search?: string) {
    const columns = await Promise.all(
      ADOPTION_FORM_STATUS_ORDER.map(async (status) => {
        const where = this.searchWhere({ organizationId, isActive: true, status }, search);
        const [forms, total] = await this.formRepository.findAndCount({
          where,
          relations: { pet: true },
          order: { updatedAt: 'DESC' },
          take: BOARD_COLUMN_LIMIT,
        });
        return {
          status,
          total,
          items: forms.map((form) => ({
            id: form.id,
            fullName: form.fullName,
            email: form.email,
            phone: form.phone,
            city: form.city,
            state: form.state,
            desiredAnimal: form.desiredAnimal,
            status: form.status,
            createdAt: form.createdAt,
            updatedAt: form.updatedAt,
            reviewedAt: form.reviewedAt ?? null,
            petId: form.petId ?? null,
            petName: form.pet?.name ?? null,
          })),
        };
      }),
    );
    return { columns };
  }

  async findHistory(id: string, organizationId: string) {
    await this.getForm(id, organizationId);
    return this.historyService.findByForm(id, organizationId);
  }

  async update(id: string, dto: UpdateAdoptionFormDto, organizationId: string, updatedBy: string = null) {
    const form = await this.getForm(id, organizationId);
    const before = { ...form };
    // Fotos têm endpoints próprios; ignora caso o front reenvie o objeto completo
    const { fotos, ...data } = dto as UpdateAdoptionFormDto & { fotos?: unknown };
    Object.assign(form, data, { updatedBy });
    if (data.birthDate) form.birthDate = localDate(data.birthDate);
    if (data.state) form.state = data.state.toUpperCase();
    this.normalizeAnswers(form);

    const { fotos: _photos, ...columns } = form;
    await this.formRepository.save(columns);

    const fields = this.changedFields(before, form);
    if (fields.length) {
      await this.historyService.record({
        form,
        type: AdoptionHistoryType.FICHA_EDITADA,
        description: `Ficha editada: ${fields.map((field) => field.label).join(', ')}`,
        metadata: { fields },
        userId: updatedBy,
      });
    }
    return this.findOne(id, organizationId);
  }

  async updateStatus(id: string, dto: UpdateAdoptionFormStatusDto, organizationId: string, reviewedBy: string = null, profileName: string = null) {
    const form = await this.getForm(id, organizationId);
    const from = form.status;
    const to = dto.status;
    if (from === to) return this.updateReviewNotes(form, dto.reviewNotes, reviewedBy);
    this.validateTransition(from, to, profileName);

    const userName = await this.historyService.resolveUserName(reviewedBy);
    const cancelledDocumentId = from === AdoptionFormStatus.AGUARDANDO_ASSINATURA ? await this.cancelPendingSignature(form.id) : null;
    await this.formRepository.manager.transaction(async (manager) => {
      await manager.getRepository(AdoptionForm).update(id, {
        status: to,
        ...(dto.reviewNotes !== undefined && { reviewNotes: dto.reviewNotes }),
        reviewedBy,
        reviewedAt: new Date(),
        updatedBy: reviewedBy,
      });

      // Efeitos no pet vinculado ao termo de adoção
      if (form.petId) {
        const pets = manager.getRepository(Pet);
        if (CONTRACT_STATUSES.includes(from)) {
          await pets.update({ id: form.petId, organizationId: form.organizationId }, { status: PetStatus.EM_PROCESSO, adoptionDate: null, updatedBy: reviewedBy });
        } else if (PET_RESERVED_STATUSES.includes(from) && PET_RELEASE_TARGETS.includes(to)) {
          await pets.update({ id: form.petId, organizationId: form.organizationId }, { status: PetStatus.DISPONIVEL, updatedBy: reviewedBy });
        }
      }

      if (cancelledDocumentId) {
        await manager.getRepository(AdoptionContract).update({ adoptionFormId: id }, { signatureStatus: ContractSignatureStatus.CANCELADO, updatedBy: reviewedBy });
      }

      await this.historyService.record(
        {
          form,
          type: AdoptionHistoryType.STATUS_ALTERADO,
          fromStatus: from,
          toStatus: to,
          description: `Status alterado de ${statusLabel(from)} para ${statusLabel(to)}`,
          metadata: {
            ...(dto.reviewNotes !== undefined && { reviewNotes: dto.reviewNotes }),
            ...(form.petId && { petId: form.petId }),
            ...(cancelledDocumentId && { cancelledSignatureDocumentId: cancelledDocumentId }),
          },
          userId: reviewedBy,
          userName,
        },
        manager,
      );
    });
    return this.findOne(id, organizationId);
  }

  async remove(id: string, organizationId: string, updatedBy: string = null) {
    const form = await this.getForm(id, organizationId);
    // A ficha fica no banco (soft delete), mas as fotos da residência são apagadas de vez
    if (form.fotos?.length) {
      await this.storageService.removePrivate(form.fotos.map((photo) => photo.storagePath));
      await this.photoRepository.delete({ adoptionFormId: id });
    }
    await this.formRepository.update(id, { isActive: false, updatedBy });
    // Pet reservado para esta ficha volta a ficar disponível (adoção concluída mantém o pet adotado)
    if (form.petId && form.status !== AdoptionFormStatus.CONCLUIDA) {
      await this.petRepository.update({ id: form.petId, organizationId, status: PetStatus.EM_PROCESSO }, { status: PetStatus.DISPONIVEL, updatedBy });
    }
    await this.historyService.record({
      form,
      type: AdoptionHistoryType.FICHA_REMOVIDA,
      fromStatus: form.status,
      description: 'Ficha removida',
      userId: updatedBy,
    });
    return { message: 'Ficha de adoção removida com sucesso.' };
  }

  async addPhotos(id: string, files: Express.Multer.File[], organizationId: string, createdBy: string = null) {
    if (!files?.length) throw new BadRequestException('Envie ao menos uma foto no campo "photos".');
    this.validatePhotoTypes(files);
    const form = await this.getForm(id, organizationId);

    const current = await this.photoRepository.count({ where: { adoptionFormId: id } });
    if (current + files.length > MAX_ADOPTION_FORM_PHOTOS) {
      throw new BadRequestException(
        `A ficha pode ter no máximo ${MAX_ADOPTION_FORM_PHOTOS} fotos. Atualmente possui ${current}, restam ${MAX_ADOPTION_FORM_PHOTOS - current}.`,
      );
    }

    await this.uploadPhotos(id, files, createdBy);
    await this.historyService.record({
      form,
      type: AdoptionHistoryType.FOTO_ADICIONADA,
      description: files.length === 1 ? '1 foto adicionada' : `${files.length} fotos adicionadas`,
      metadata: { count: files.length },
      userId: createdBy,
    });
    return this.findOne(id, organizationId);
  }

  async removePhoto(id: string, photoId: string, organizationId: string, removedBy: string = null) {
    const form = await this.getForm(id, organizationId);
    const photo = await this.photoRepository.findOne({ where: { id: photoId, adoptionFormId: id } });
    if (!photo) throw new NotFoundException('Foto não encontrada.');
    await this.storageService.removePrivate([photo.storagePath]);
    await this.photoRepository.delete(photo.id);
    await this.historyService.record({
      form,
      type: AdoptionHistoryType.FOTO_REMOVIDA,
      description: 'Foto removida',
      metadata: { photoId },
      userId: removedBy,
    });
    return { message: 'Foto removida com sucesso.' };
  }

  // PATCH com o mesmo status só edita as observações (sem efeitos de transição)
  private async updateReviewNotes(form: AdoptionForm, reviewNotes: string | undefined, updatedBy: string) {
    const before = form.reviewNotes ?? null;
    const after = reviewNotes === undefined ? before : reviewNotes;
    if ((before ?? '') !== (after ?? '')) {
      await this.formRepository.update(form.id, { reviewNotes: after, updatedBy });
      await this.historyService.record({
        form,
        type: AdoptionHistoryType.FICHA_EDITADA,
        description: 'Observações da avaliação atualizadas',
        metadata: { fields: [{ field: 'reviewNotes', label: 'Observações', before, after }] },
        userId: updatedBy,
      });
    }
    return this.findOne(form.id, form.organizationId);
  }

  // Voltando de Aguardando assinatura: exclui o documento no Autentique (falha não bloqueia a movimentação)
  private async cancelPendingSignature(formId: string) {
    const contract = await this.contractRepository.findOne({ where: { adoptionFormId: formId } });
    if (!contract?.autentiqueDocumentId || contract.signatureStatus !== ContractSignatureStatus.PENDENTE) return null;
    await this.autentiqueService.deleteDocument(contract.autentiqueDocumentId).catch((error) => {
      this.logger.warn(`Não foi possível excluir o documento ${contract.autentiqueDocumentId} no Autentique: ${error?.message}`);
    });
    return contract.autentiqueDocumentId;
  }

  // Regras de movimentação manual (PATCH :id/status); assinatura e conclusão só pelo fluxo do Autentique
  private validateTransition(from: AdoptionFormStatus, to: AdoptionFormStatus, profileName: string) {
    if (to === AdoptionFormStatus.CONCLUIDA) {
      throw new BadRequestException('A adoção é concluída automaticamente quando o adotante assina o termo de adoção.');
    }
    if (SIGNATURE_STATUSES.includes(to)) {
      throw new BadRequestException('Envie o termo de adoção para assinatura pela aba Termo de Adoção.');
    }
    if (CONTRACT_STATUSES.includes(from)) {
      if (to !== AdoptionFormStatus.APROVADO) {
        throw new BadRequestException(`Uma ficha em ${statusLabel(from)} só pode voltar para Aprovado.`);
      }
      if (profileName !== 'ADMIN') {
        throw new ForbiddenException('Somente administradores podem voltar uma ficha com termo de adoção para Aprovado.');
      }
      return;
    }
    if (!REVIEW_STATUSES.includes(to)) throw new BadRequestException('Movimentação de status não permitida.');
  }

  // Campos alterados numa edição, com rótulo para exibir no histórico
  private changedFields(before: AdoptionForm, after: AdoptionForm) {
    return Object.keys(ADOPTION_FORM_FIELD_LABELS)
      .filter((field) => JSON.stringify(comparable(before[field])) !== JSON.stringify(comparable(after[field])))
      .map((field) => ({
        field,
        label: ADOPTION_FORM_FIELD_LABELS[field],
        before: comparable(before[field]),
        after: comparable(after[field]),
      }));
  }

  private searchWhere(base: FindOptionsWhere<AdoptionForm>, rawSearch?: string) {
    const search = rawSearch?.trim();
    if (!search) return base;
    return [
      { ...base, fullName: ILike(`%${search}%`) },
      { ...base, email: ILike(`%${search}%`) },
      { ...base, cpf: ILike(`%${search.replace(/\D/g, '') || search}%`) },
    ];
  }

  private petSummary(pet: Pet) {
    if (!pet) return null;
    const fotos = [...(pet.fotos ?? [])].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return { id: pet.id, name: pet.name, species: pet.species, fotos: fotos.map((foto) => ({ url: foto.url })) };
  }

  private async getForm(id: string, organizationId: string, withPet = false) {
    const form = await this.formRepository.findOne({
      where: { id, organizationId, isActive: true },
      relations: withPet ? { fotos: true, pet: { fotos: true }, desiredPet: { fotos: true } } : { fotos: true },
    });
    if (!form) throw new NotFoundException('Ficha de adoção não encontrada.');
    return this.sortPhotos(form);
  }

  // Fotos ficam no bucket privado: cada leitura devolve URLs assinadas e temporárias
  private async signPhotoUrls(forms: AdoptionForm[]) {
    const photos = forms.flatMap((form) => form.fotos ?? []);
    const signed = await this.storageService.getSignedUrls(photos.map((photo) => photo.storagePath));
    photos.forEach((photo) => {
      photo.url = signed[photo.storagePath] ?? photo.url;
    });
  }

  private validatePhotoTypes(files: Express.Multer.File[]) {
    const invalid = files.find((file) => !ALLOWED_PHOTO_TYPES.includes(file.mimetype));
    if (invalid) throw new BadRequestException('Formato inválido. Envie apenas imagens JPEG, PNG ou WEBP.');
  }

  private async uploadPhotos(adoptionFormId: string, files: Express.Multer.File[], createdBy: string = null) {
    const uploaded: string[] = [];
    try {
      for (const file of files) {
        const path = `adoption-forms/${adoptionFormId}/${randomUUID()}${extname(file.originalname).toLowerCase()}`;
        await this.storageService.uploadPrivate(path, file.buffer, file.mimetype);
        uploaded.push(path);
      }
      const photos = this.photoRepository.create(
        uploaded.map((path) => ({ adoptionFormId, url: null, storagePath: path, createdBy })),
      );
      await this.photoRepository.save(photos);
    } catch (error) {
      // Evita arquivos órfãos no bucket caso algum upload ou o insert falhe
      await this.storageService.removePrivate(uploaded).catch(() => undefined);
      throw error;
    }
  }

  // Valida as respostas condicionais já com a ficha completa e limpa as que não se aplicam
  private normalizeAnswers(form: AdoptionForm) {
    const errors: string[] = [];

    if (form.hasPets === 'yes') {
      if (!(form.petsCount >= 1)) errors.push('Informe quantos animais você tem.');
    } else {
      form.petsCount = 0;
      form.petsVaccinesUpToDate = 'no_pets';
      form.catFivFelvTested = 'no_cat';
    }

    for (const { field, visible, message } of CONDITIONAL_ANSWERS) {
      if (!visible(form)) {
        (form as any)[field] = null;
      } else if (form[field] === undefined || form[field] === null || form[field] === '') {
        errors.push(message);
      }
    }

    if (errors.length) throw new BadRequestException(errors);
  }

  private sortPhotos(form: AdoptionForm) {
    form.fotos?.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return form;
  }
}
