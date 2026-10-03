import { Module, Global } from '@nestjs/common';
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

class MockMailService {
  async sendConfirmationEmail() {}
  async sendApprovalEmail() {}
  async sendPasswordResetEmail() {}
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
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      entities: [
        Organization, Profile, User, Pet, PetPhoto, MedicalRecord, Team, Volunteer,
        Campaign, FinancialEntry, FinancialExpense, Partner, BankAccount, OrganizationAddress, AdoptionForm, AdoptionFormPhoto,
        AdoptionHistoryEvent, AdoptionContract,
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
    VolunteerModule,
    CampaignModule,
    FinancialModule,
    PartnerModule,
    BankAccountModule,
    OrganizationAddressModule,
    AdoptionFormModule,
    AdoptionHistoryModule,
    AdoptionContractModule,
    WebhooksModule,
    MockMailModule,
    MockStorageModule,
    MockAutentiqueModule,
  ],
})
export class TestAppModule {}
