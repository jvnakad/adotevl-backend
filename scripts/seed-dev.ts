// Seed do ambiente local: organização + usuário ADMIN para testar o sistema sem o Supabase.
// Uso: npm run seed:dev (com o Postgres local rodando e o .env.local configurado)
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { Organization } from '../src/organization/organization.entity';
import { Profile } from '../src/profile/profile.entity';
import { User } from '../src/user/user.entity';

const DEV_ORG_CNPJ = '00000000000191';
const DEV_ADMIN_EMAIL = 'admin@adotevl.local';
const DEV_ADMIN_PASSWORD = 'admin123';

async function seed() {
  if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.DATABASE_URL?.includes('127.0.0.1')) {
    // Evita rodar o seed por engano contra o banco de produção
    throw new Error('seed:dev só roda com DATABASE_URL apontando para localhost.');
  }

  // Sobe o contexto da aplicação: cria as tabelas (synchronize) e os perfis padrão (ProfileService)
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });

  const orgRepo = app.get<Repository<Organization>>(getRepositoryToken(Organization));
  const profileRepo = app.get<Repository<Profile>>(getRepositoryToken(Profile));
  const userRepo = app.get<Repository<User>>(getRepositoryToken(User));

  let organization = await orgRepo.findOne({ where: { cnpj: DEV_ORG_CNPJ } });
  if (!organization) {
    organization = await orgRepo.save(orgRepo.create({ legalName: 'AdoteVL Dev', cnpj: DEV_ORG_CNPJ }));
  }

  const profiles = await profileRepo.find();
  const adminProfile = profiles.find((p) => p.name === 'ADMIN');

  const existingAdmin = await userRepo.findOne({ where: { email: DEV_ADMIN_EMAIL } });
  if (!existingAdmin) {
    await userRepo.save(
      userRepo.create({
        fullName: 'Admin Dev',
        cpf: '00000000000',
        email: DEV_ADMIN_EMAIL,
        phone: '11999999999',
        password: await bcrypt.hash(DEV_ADMIN_PASSWORD, 10),
        profileId: adminProfile.id,
        organizationId: organization.id,
        isConfirmed: true,
        isApproved: true,
        isActive: true,
      }),
    );
  }

  const profileId = (name: string) => profiles.find((p) => p.name === name)?.id;
  console.log('\nSeed concluído.\n');
  console.log(`Login: ${DEV_ADMIN_EMAIL} / ${DEV_ADMIN_PASSWORD}\n`);
  console.log('Variáveis para o .env do front (react-tailwind-adotevl):');
  console.log(`VITE_API_URL=http://localhost:${process.env.PORT || 3000}`);
  console.log(`VITE_ORGANIZATION_ID=${organization.id}`);
  console.log(`VITE_PROFILE_ADMIN=${profileId('ADMIN')}`);
  console.log(`VITE_PROFILE_VOLUNTEER=${profileId('VOLUNTEER')}\n`);

  await app.close();
}

seed().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
