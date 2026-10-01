import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike, FindOptionsWhere } from 'typeorm';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import { AdoptionForm, AdoptionFormStatus } from './adoption-form.entity';
import { AdoptionFormPhoto } from './adoption-form-photo.entity';
import { Organization } from '../organization/organization.entity';
import { CreateAdoptionFormDto } from './dto/create-adoption-form.dto';
import { UpdateAdoptionFormDto } from './dto/update-adoption-form.dto';
import { UpdateAdoptionFormStatusDto } from './dto/update-adoption-form-status.dto';
import { PaginationDto } from '../common/pagination.dto';
import { paginate } from '../common/paginate.helper';
import { StorageService } from '../storage/storage.service';

export const MAX_ADOPTION_FORM_PHOTOS = 6;
export const MAX_ADOPTION_PHOTO_SIZE = 5 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

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
export class AdoptionFormService {
  constructor(
    @InjectRepository(AdoptionForm)
    private readonly formRepository: Repository<AdoptionForm>,
    @InjectRepository(AdoptionFormPhoto)
    private readonly photoRepository: Repository<AdoptionFormPhoto>,
    @InjectRepository(Organization)
    private readonly organizationRepository: Repository<Organization>,
    private readonly storageService: StorageService,
  ) {}

  // Rota pública: não devolve os dados pessoais enviados, só a confirmação
  async create(dto: CreateAdoptionFormDto, files: Express.Multer.File[]) {
    if (!files?.length) throw new BadRequestException('Envie pelo menos uma foto da residência no campo "photos".');
    this.validatePhotoTypes(files);

    const organization = await this.organizationRepository.findOne({ where: { id: dto.organizationId, isActive: true } });
    if (!organization) throw new BadRequestException('Organização não encontrada.');

    const form = this.formRepository.create({ ...dto, birthDate: new Date(dto.birthDate), state: dto.state.toUpperCase() });
    this.normalizeAnswers(form);

    const saved = await this.formRepository.save(form);
    try {
      await this.uploadPhotos(saved.id, files);
    } catch (error) {
      await this.formRepository.delete(saved.id);
      throw error;
    }

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

    const search = filters.search?.trim();
    const where = search
      ? [
          { ...base, fullName: ILike(`%${search}%`) },
          { ...base, email: ILike(`%${search}%`) },
          { ...base, cpf: ILike(`%${search.replace(/\D/g, '') || search}%`) },
        ]
      : base;

    const result = await paginate(this.formRepository, pagination, where, { fotos: true }, { createdAt: 'DESC' });
    result.data.forEach((form) => this.sortPhotos(form));
    await this.signPhotoUrls(result.data);
    return result;
  }

  async findOne(id: string, organizationId: string) {
    const form = await this.getForm(id, organizationId);
    await this.signPhotoUrls([form]);
    return form;
  }

  async update(id: string, dto: UpdateAdoptionFormDto, organizationId: string, updatedBy: string = null) {
    const form = await this.getForm(id, organizationId);
    // Fotos têm endpoints próprios; ignora caso o front reenvie o objeto completo
    const { fotos, ...data } = dto as UpdateAdoptionFormDto & { fotos?: unknown };
    Object.assign(form, data, { updatedBy });
    if (data.birthDate) form.birthDate = new Date(data.birthDate);
    if (data.state) form.state = data.state.toUpperCase();
    this.normalizeAnswers(form);

    const { fotos: _photos, ...columns } = form;
    await this.formRepository.save(columns);
    return this.findOne(id, organizationId);
  }

  async updateStatus(id: string, dto: UpdateAdoptionFormStatusDto, organizationId: string, reviewedBy: string = null) {
    await this.getForm(id, organizationId);
    await this.formRepository.update(id, {
      status: dto.status,
      ...(dto.reviewNotes !== undefined && { reviewNotes: dto.reviewNotes }),
      reviewedBy,
      reviewedAt: new Date(),
      updatedBy: reviewedBy,
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
    return { message: 'Ficha de adoção removida com sucesso.' };
  }

  async addPhotos(id: string, files: Express.Multer.File[], organizationId: string, createdBy: string = null) {
    if (!files?.length) throw new BadRequestException('Envie ao menos uma foto no campo "photos".');
    this.validatePhotoTypes(files);
    await this.getForm(id, organizationId);

    const current = await this.photoRepository.count({ where: { adoptionFormId: id } });
    if (current + files.length > MAX_ADOPTION_FORM_PHOTOS) {
      throw new BadRequestException(
        `A ficha pode ter no máximo ${MAX_ADOPTION_FORM_PHOTOS} fotos. Atualmente possui ${current}, restam ${MAX_ADOPTION_FORM_PHOTOS - current}.`,
      );
    }

    await this.uploadPhotos(id, files, createdBy);
    return this.findOne(id, organizationId);
  }

  async removePhoto(id: string, photoId: string, organizationId: string) {
    await this.getForm(id, organizationId);
    const photo = await this.photoRepository.findOne({ where: { id: photoId, adoptionFormId: id } });
    if (!photo) throw new NotFoundException('Foto não encontrada.');
    await this.storageService.removePrivate([photo.storagePath]);
    await this.photoRepository.delete(photo.id);
    return { message: 'Foto removida com sucesso.' };
  }

  private async getForm(id: string, organizationId: string) {
    const form = await this.formRepository.findOne({
      where: { id, organizationId, isActive: true },
      relations: { fotos: true },
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
