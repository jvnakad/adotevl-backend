import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { TestAppModule, joinTeam, cleanupAccess } from './test-app.module';
import { Profile } from '../src/profile/profile.entity';
import { Organization } from '../src/organization/organization.entity';
import { User } from '../src/user/user.entity';

/**
 * Base dos e2e da sessão do painel (refresh token): sobe o app com Postgres real, cria uma organização própria (CNPJ fixo por suíte)
 * e dá helpers de login, renovação, logout e usuários. O login tem limite de 10/min por IP, então cada chamada usa um IP novo
 * (X-Forwarded-For com `trust proxy`); o limite em si é testado à parte, com IP fixo.
 */
export class SessionFixture {
  app: INestApplication;
  moduleFixture: TestingModule;
  dataSource: DataSource;
  userRepo: Repository<User>;
  orgRepo: Repository<Organization>;
  jwt: JwtService;
  orgId: string;
  profileId: string;
  readonly logs: string[] = [];
  private seq = 0;
  private ttlBefore: string | undefined;

  constructor(private readonly cnpj: string, private readonly label: string, private readonly options: { accessTtl?: string } = {}) {}

  static async boot(cnpj: string, label: string, options: { accessTtl?: string } = {}) {
    const fixture = new SessionFixture(cnpj, label, options);
    await fixture.start();
    return fixture;
  }

  private async start() {
    this.ttlBefore = process.env.ACCESS_TOKEN_TTL;
    if (this.options.accessTtl) process.env.ACCESS_TOKEN_TTL = this.options.accessTtl;
    this.moduleFixture = await Test.createTestingModule({ imports: [TestAppModule] }).compile();
    this.app = this.moduleFixture.createNestApplication();
    this.app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    this.app.getHttpAdapter().getInstance().set('trust proxy', true);
    await this.app.init();
    await this.app.listen(0);

    this.dataSource = this.moduleFixture.get(DataSource);
    this.userRepo = this.moduleFixture.get(getRepositoryToken(User));
    this.orgRepo = this.moduleFixture.get(getRepositoryToken(Organization));
    this.jwt = this.app.get(JwtService);
    const profileRepo: Repository<Profile> = this.moduleFixture.get(getRepositoryToken(Profile));

    // Eventos de segurança: o Logger do Nest vai para um array, sem poluir a saída
    for (const level of ['log', 'warn', 'error'] as const) jest.spyOn(Logger.prototype, level).mockImplementation((message: unknown) => void this.logs.push(String(message)));

    const existing = await this.orgRepo.findOne({ where: { cnpj: this.cnpj } });
    if (existing) await this.removeOrg(existing.id);
    if (!(await profileRepo.findOne({ where: { name: 'VOLUNTEER' } }))) await profileRepo.save([{ name: 'ADMIN' }, { name: 'FINANCIAL' }, { name: 'VOLUNTEER' }]);
    this.profileId = (await profileRepo.findOne({ where: { name: 'VOLUNTEER' } })).id;
    this.orgId = (await this.orgRepo.save({ legalName: `Org ${this.label}`, cnpj: this.cnpj })).id;
  }

  private async removeOrg(id: string) {
    await cleanupAccess(this.app, id);
    await this.userRepo.delete({ organizationId: id }); // refresh_tokens some junto (ON DELETE CASCADE)
    await this.orgRepo.delete({ id });
  }

  async close() {
    await this.removeOrg(this.orgId);
    await this.app.close();
    jest.restoreAllMocks();
    if (this.ttlBefore === undefined) delete process.env.ACCESS_TOKEN_TTL;
    else process.env.ACCESS_TOKEN_TTL = this.ttlBefore;
  }

  server = () => this.app.getHttpServer();
  nextIp = () => `10.${Math.floor(this.seq / 60000) % 250}.${Math.floor(this.seq / 250) % 250}.${(this.seq++ % 250) + 1}`;
  bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  login = (email: string, password = 'senha123', ip = this.nextIp()) => request(this.server()).post('/auth/login').set('X-Forwarded-For', ip).send({ email, password });
  refresh = (refreshToken: unknown, ip = this.nextIp()) => request(this.server()).post('/auth/refresh').set('X-Forwarded-For', ip).send({ refreshToken });
  logout = (refreshToken: unknown, ip = this.nextIp()) => request(this.server()).post('/auth/logout').set('X-Forwarded-For', ip).send({ refreshToken });
  me = (access: string) => request(this.server()).get('/auth/me').set(this.bearer(access));
  /** Login que espera sucesso e devolve o par. */
  session = async (email: string, password = 'senha123') => {
    const res = await this.login(email, password);
    if (res.status !== 201) throw new Error(`login de ${email} falhou: ${res.status}`);
    return { access: res.body.access_token as string, refresh: res.body.refresh_token as string };
  };

  createUser = async (name: string, overrides: Partial<User> = {}) =>
    this.userRepo.save(
      this.userRepo.create({
        fullName: name,
        cpf: String(12000000000 + ++this.seq),
        email: `${name.toLowerCase().replace(/\s+/g, '.')}@${this.label.toLowerCase().replace(/\s+/g, '')}.teste.com`,
        phone: '11900000000',
        password: await bcrypt.hash('senha123', 4),
        profileId: this.profileId,
        organizationId: this.orgId,
        isConfirmed: true,
        isApproved: true,
        isActive: true,
        ...overrides,
      }),
    );
  /** Voluntário fixo com acesso a Pets (Visualizar) */
  createFixed = async (name: string, overrides: Partial<User> = {}) => {
    const user = await this.createUser(name, overrides);
    await joinTeam(this.app, user, { PETS: 'VIEW' } as any);
    return user;
  };

  rowsOf = (userId: string) => this.dataSource.query('SELECT * FROM refresh_tokens WHERE user_id = $1 ORDER BY created_at, id', [userId]);
  familiesOf = (userId: string) => this.dataSource.query('SELECT DISTINCT family_id FROM refresh_tokens WHERE user_id = $1', [userId]);
  sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
}

export const REFRESH_FORMAT = /^[A-Za-z0-9_-]{43}$/;
export const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const EXPIRED_BODY = { statusCode: 401, message: 'Sessão expirada. Faça login novamente.', error: 'Unauthorized' };
/** Um refresh bem formado que não existe */
export const unknownRefresh = () => 'Z'.repeat(43);
