import { Module, Global, INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TeamService } from '../src/team/team.service';
import { TeamMembershipService } from '../src/team/team-membership.service';
import { ScreenPermissions } from '../src/access/access';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { Organization } from '../src/organization/organization.entity';
import { Profile } from '../src/profile/profile.entity';
import { User } from '../src/user/user.entity';
import { Pet } from '../src/pet/pet.entity';
import { PetPhoto } from '../src/pet/pet-photo.entity';
import { MedicalRecord } from '../src/medical-record/medical-record.entity';
import { Team } from '../src/team/team.entity';
import { Volunteer } from '../src/volunteer/volunteer.entity';
import { Campaign } from '../src/campaign/campaign.entity';
import { FinancialEntry } from '../src/financial/financial-entry.entity';
import { FinancialExpense } from '../src/financial/financial-expense.entity';
import { Partner } from '../src/partner/partner.entity';
import { BankAccount } from '../src/bank-account/bank-account.entity';
import { OrganizationAddress } from '../src/organization-address/organization-address.entity';
import { OrganizationModule } from '../src/organization/organization.module';
import { ProfileModule } from '../src/profile/profile.module';
import { UserModule } from '../src/user/user.module';
import { AuthModule } from '../src/auth/auth.module';
import { PetModule } from '../src/pet/pet.module';
import { MedicalRecordModule } from '../src/medical-record/medical-record.module';
import { TeamModule } from '../src/team/team.module';
import { VolunteerModule } from '../src/volunteer/volunteer.module';
import { CampaignModule } from '../src/campaign/campaign.module';
import { FinancialModule } from '../src/financial/financial.module';
import { PartnerModule } from '../src/partner/partner.module';
import { BankAccountModule } from '../src/bank-account/bank-account.module';
import { OrganizationAddressModule } from '../src/organization-address/organization-address.module';
import { AdoptionForm } from '../src/adoption-form/adoption-form.entity';
import { AdoptionFormPhoto } from '../src/adoption-form/adoption-form-photo.entity';
import { AdoptionFormModule } from '../src/adoption-form/adoption-form.module';
import { AdoptionHistoryEvent } from '../src/adoption-history/adoption-history.entity';
import { AdoptionHistoryModule } from '../src/adoption-history/adoption-history.module';
import { AdoptionContract } from '../src/adoption-contract/adoption-contract.entity';
import { AdoptionContractModule } from '../src/adoption-contract/adoption-contract.module';
import { MailService } from '../src/mail/mail.service';
import { StorageService } from '../src/storage/storage.service';
import { AutentiqueService } from '../src/autentique/autentique.service';
import { WebhooksModule } from '../src/webhooks/webhooks.module';
import { TeamPermission } from '../src/team/team-permission.entity';
import { AccessModule } from '../src/access/access.module';
import { VolunteerShift } from '../src/volunteer-schedule/volunteer-shift.entity';
import { ScheduleLock } from '../src/volunteer-schedule/schedule-lock.entity';
import { ScheduleAccessCode } from '../src/volunteer-schedule/schedule-access-code.entity';
import { PasswordResetCode } from '../src/auth/password-reset-code.entity';
import { EmailChangeRequest } from '../src/user/email-change-request.entity';
import { EmailChangeEvent } from '../src/user/email-change-event.entity';
import { VolunteerScheduleModule } from '../src/volunteer-schedule/volunteer-schedule.module';
import { VolunteerApplication } from '../src/volunteer-application/volunteer-application.entity';
import { ProductType } from '../src/stock/product-type.entity';
import { Product } from '../src/stock/product.entity';
import { StockHistoryEvent } from '../src/stock/stock-history.entity';
import { NullByteModule } from '../src/common/null-byte.middleware';
import { StockModule } from '../src/stock/stock.module';
import { ScheduleInstitution } from '../src/volunteer-schedule/schedule-institution.entity';
import { MarketingModule } from '../src/marketing/marketing.module';
import { RealtimeModule } from '../src/realtime/realtime.module';
import { NotificationModule } from '../src/notification/notification.module';
import { Notification } from '../src/notification/notification.entity';
import { MarketingList } from '../src/marketing/entities/marketing-list.entity';
import { MarketingLabel } from '../src/marketing/entities/marketing-label.entity';
import { MarketingCard } from '../src/marketing/entities/marketing-card.entity';
import { MarketingCardMember } from '../src/marketing/entities/marketing-card-member.entity';
import { MarketingCardLabel } from '../src/marketing/entities/marketing-card-label.entity';
import { MarketingCardTask } from '../src/marketing/entities/marketing-card-task.entity';
import { MarketingCardAttachment } from '../src/marketing/entities/marketing-card-attachment.entity';
import { MarketingCardComment } from '../src/marketing/entities/marketing-card-comment.entity';
import { MarketingHistoryEvent } from '../src/marketing/entities/marketing-history-event.entity';

/**
 * Trava de segurança do e2e: só roda contra Postgres local. DATABASE_URL tem de vir do processo e apontar para localhost ou 127.0.0.1.
 * Ex.: DATABASE_URL="postgresql://usuario:senha@localhost:5432/adotevl_e2e?sslmode=disable" JWT_SECRET=... npm run test:e2e
 */
export function assertLocalTestDatabase(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('E2E recusado: defina DATABASE_URL (Postgres local, host localhost ou 127.0.0.1). O .env não é lido nos testes.');
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error('E2E recusado: DATABASE_URL inválida. Use um Postgres local (localhost ou 127.0.0.1).');
  }
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)) {
    throw new Error('E2E recusado: DATABASE_URL não aponta para localhost ou 127.0.0.1. Os testes apagam e recriam dados.');
  }
}
assertLocalTestDatabase();

class MockMailService {
  async sendConfirmationEmail() {}
  async sendApprovalEmail() {}
  async sendPasswordResetEmail() {}
  async sendFloatingWelcomeEmail() {}
  // Esqueci minha senha: o e2e lê o último código e confere quem recebeu e-mail
  lastPasswordResetCode: string | null = null;
  passwordResetCodeSentTo: string[] = [];
  passwordChangedSentTo: string[] = [];
  async sendPasswordResetCodeEmail(to: string, _name: string, code: string) {
    this.lastPasswordResetCode = code;
    this.passwordResetCodeSentTo.push(to);
  }
  // Troca de e-mail: o e2e lê o último código e confere quem recebeu
  lastEmailChangeCode: string | null = null;
  emailChangeCodeSentTo: string[] = [];
  failEmailChangeSend = false;
  async sendEmailChangeCodeEmail(to: string, code: string) {
    if (this.failEmailChangeSend) throw new Error('envio falhou');
    this.lastEmailChangeCode = code;
    this.emailChangeCodeSentTo.push(to);
  }
  async sendPasswordChangedEmail(to: string) {
    this.passwordChangedSentTo.push(to);
  }
  // Último turno confirmado por e-mail (o e2e da agenda confere faculdade e curso)
  lastShiftConfirmation: { institutionName?: string | null; course?: string | null } | null = null;
  async sendShiftConfirmationEmail(_to: string, _name: string, shift: { institutionName?: string | null; course?: string | null }) {
    this.lastShiftConfirmation = shift;
  }
  async sendShiftCancelledByLockEmail() {}
  // Último código enviado por e-mail (o e2e da agenda lê daqui)
  lastScheduleCode: string | null = null;
  async sendScheduleCodeEmail(_to: string, _name: string, code: string) {
    this.lastScheduleCode = code;
  }
}

@Global()
@Module({
  providers: [{ provide: MailService, useClass: MockMailService }],
  exports: [MailService],
})
class MockMailModule {}

export class MockStorageService {
  async upload(path: string) {
    return `https://storage.test/pet-photos/${path}`;
  }
  async remove() {}
  async uploadPrivate() {}
  async removePrivate() {}
  async downloadPrivate() {
    return Buffer.from('%PDF-fake');
  }
  async getSignedUrls(paths: string[]) {
    return Object.fromEntries(paths.map((path) => [path, `https://storage.test/signed/${path}`]));
  }
}

@Global()
@Module({
  providers: [{ provide: StorageService, useClass: MockStorageService }],
  exports: [StorageService],
})
class MockStorageModule {}

// Autentique falso: documentos ficam em memória; o teste simula o adotante com adopterSigns/adopterRejects
export class MockAutentiqueService {
  documents = new Map<string, { email: string; name: string; signedAt: string | null; rejectedAt: string | null; organizationSigned: boolean }>();
  account = { name: 'Associação Teste', email: 'associacao@autentique.test' };
  private sequence = 0;

  async getAccount() {
    return this.account;
  }
  // O adotante é o signatário que não é a conta da associação
  async createDocument({ signers }: { signers: { name: string; email: string }[] }) {
    const id = `doc-${++this.sequence}`;
    const adopter = signers.find((signer) => signer.email !== this.account.email);
    this.documents.set(id, { email: adopter.email, name: adopter.name, signedAt: null, rejectedAt: null, organizationSigned: false });
    return this.toDocument(id);
  }
  async signDocument(id: string) {
    this.documents.get(id).organizationSigned = true;
  }
  async getDocument(id: string) {
    return this.documents.has(id) ? this.toDocument(id) : null;
  }
  async deleteDocument(id: string) {
    this.documents.delete(id);
  }
  async downloadFile() {
    return Buffer.from('%PDF-signed');
  }
  adopterSigns(id: string) {
    this.documents.get(id).signedAt = new Date().toISOString();
  }
  adopterRejects(id: string) {
    this.documents.get(id).rejectedAt = new Date().toISOString();
  }
  private toDocument(id: string) {
    const doc = this.documents.get(id);
    return {
      id,
      name: 'Termo de Adoção',
      signedFileUrl: `https://autentique.test/${id}/assinado.pdf`,
      signatures: [{ publicId: `sig-${id}`, name: doc.name, email: doc.email, link: `https://assina.test/${id}`, viewedAt: null, signedAt: doc.signedAt, rejectedAt: doc.rejectedAt }],
    };
  }
}

@Global()
@Module({
  providers: [{ provide: AutentiqueService, useClass: MockAutentiqueService }],
  exports: [AutentiqueService],
})
class MockAutentiqueModule {}

@Module({
  imports: [
    // Nunca lê .env: ele pode apontar para o banco de produção. Tudo vem do processo (ver assertLocalTestDatabase)
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      entities: [
        Organization, Profile, User, Pet, PetPhoto, MedicalRecord, Team, TeamPermission, Volunteer,
        Campaign, FinancialEntry, FinancialExpense, Partner, BankAccount, OrganizationAddress, AdoptionForm, AdoptionFormPhoto,
        AdoptionHistoryEvent, AdoptionContract, VolunteerApplication, VolunteerShift, ScheduleLock, ScheduleAccessCode, PasswordResetCode, EmailChangeRequest, EmailChangeEvent, ScheduleInstitution, ProductType, Product, StockHistoryEvent,
        MarketingList, MarketingLabel, MarketingCard, MarketingCardMember, MarketingCardLabel, MarketingCardTask, MarketingCardAttachment, MarketingCardComment, MarketingHistoryEvent, Notification,
      ],
      synchronize: true,
      ssl: process.env.DATABASE_URL?.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
    }),
    OrganizationModule,
    ProfileModule,
    UserModule,
    AuthModule,
    PetModule,
    MedicalRecordModule,
    TeamModule,
    AccessModule,
    VolunteerModule,
    CampaignModule,
    FinancialModule,
    PartnerModule,
    BankAccountModule,
    OrganizationAddressModule,
    AdoptionFormModule,
    AdoptionHistoryModule,
    AdoptionContractModule,
    VolunteerScheduleModule,
    StockModule,
    RealtimeModule,
    NotificationModule,
    MarketingModule,
    NullByteModule,
    WebhooksModule,
    MockMailModule,
    MockStorageModule,
    MockAutentiqueModule,
  ],
})
export class TestAppModule {}

// ---- Acesso por equipe nas suítes e2e ----

type TestUser = { id: string; fullName: string; cpf: string; organizationId: string; birthDate?: Date };

/**
 * Coloca o usuário numa equipe: 'ADMIN' = equipe Admin da organização (acesso total);
 * um objeto de permissões = equipe própria do usuário com aquele acesso (ex.: o antigo perfil VOLUNTEER).
 */
export async function joinTeam(app: INestApplication, user: TestUser, access: 'ADMIN' | ScreenPermissions) {
  const teams = app.get(TeamService);
  const team =
    access === 'ADMIN'
      ? await teams.ensureAdminTeam(user.organizationId)
      : await teams.create({ name: `Equipe ${user.fullName}`, organizationId: user.organizationId });
  if (access !== 'ADMIN') await teams.setPermissions(team.id, access);
  await app.get(TeamMembershipService).assign({ birthDate: null, ...user }, team.id, null);
  return team;
}

/** Remove voluntários e equipes da organização (antes de apagar os usuários: FK de volunteers.user_id). */
export async function cleanupAccess(app: INestApplication, organizationId: string) {
  const dataSource = app.get(DataSource);
  // O seed das filas do Marketing roda no boot para toda organização: sem limpar, o FK RESTRICT impede apagar a organização de qualquer suíte
  await cleanupMarketing(app, organizationId);
  // Idem a agenda: o seed da PUCPR roda para toda organização e o RESTRICT de volunteer_shifts impede apagar a faculdade antes dos turnos
  await dataSource.query('DELETE FROM volunteer_shifts WHERE organization_id = $1', [organizationId]);
  await dataSource.query('DELETE FROM schedule_locks WHERE organization_id = $1', [organizationId]);
  await dataSource.query('DELETE FROM schedule_institutions WHERE organization_id = $1', [organizationId]);
  await dataSource.query('DELETE FROM notifications WHERE organization_id = $1', [organizationId]);
  await dataSource.query('DELETE FROM volunteers WHERE user_id IN (SELECT id FROM users WHERE organization_id = $1)', [organizationId]);
  await dataSource.query('DELETE FROM teams WHERE organization_id = $1', [organizationId]);
}

/** Remove o estoque da organização (antes de apagar a organização: FKs RESTRICT). Ordem: eventos, produtos, tipos. */
export async function cleanupStock(app: INestApplication, organizationId: string) {
  const dataSource = app.get(DataSource);
  await dataSource.query('DELETE FROM stock_history_events WHERE organization_id = $1', [organizationId]);
  await dataSource.query('DELETE FROM products WHERE organization_id = $1', [organizationId]);
  await dataSource.query('DELETE FROM product_types WHERE organization_id = $1', [organizationId]);
}

/** Remove o Marketing da organização (antes de apagar a organização: FKs RESTRICT do histórico e das filas). */
export async function cleanupMarketing(app: INestApplication, organizationId: string) {
  const dataSource = app.get(DataSource);
  await dataSource.query('DELETE FROM marketing_history_events WHERE organization_id = $1', [organizationId]);
  await dataSource.query('UPDATE marketing_cards SET cover_attachment_id = NULL WHERE organization_id = $1', [organizationId]);
  await dataSource.query('DELETE FROM marketing_cards WHERE organization_id = $1', [organizationId]);
  await dataSource.query('DELETE FROM marketing_labels WHERE organization_id = $1', [organizationId]);
  await dataSource.query('DELETE FROM marketing_lists WHERE organization_id = $1', [organizationId]);
}

/** Questionário válido do voluntário fixo (POST /users). */
export const VOLUNTEER_APPLICATION = {
  city: 'Curitiba',
  neighborhood: 'Boqueirão',
  referralSources: ['INSTAGRAM'],
  interestAreas: ['EVENTOS', 'OUTROS'],
  interestOther: 'Lar temporário',
  aboutYou: 'Gosto de cuidar de bichos.',
  strengthWeakness: 'Ansiosa e dedicada.',
  unpaidWorkFeeling: 'Faço por amor.',
  strayAnimalsFeeling: 'QUERO_MUDAR',
  loyalty: 'SIM',
  witnessedAbuse: true,
  pressureHandling: 'CONSIGO',
  stressReaction: 'PACIFICA',
  roadkillActions: ['PESQUISA_HOSPITAIS', 'VAI_AO_LOCAL'],
  emergencyRescueHelp: 'Divulgo e busco lar temporário.',
  debtActions: ['RIFA'],
  availablePeriods: ['NOITE'],
  tools: ['CANVA', 'INSTAGRAM'],
  shelterVisit: 'SIM',
  acceptsInterview: true,
};
