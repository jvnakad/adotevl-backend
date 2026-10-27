import { RealtimeGateway } from './realtime.gateway';

const claims = { sub: 'u1', organizationId: 'org-1', exp: 9999999999, iat: 100 };
const active = { isActive: true, passwordChangedAt: null, systemKey: null };

describe('RealtimeGateway: autenticação do handshake', () => {
  let jwt: { verifyAsync: jest.Mock };
  let dataSource: { query: jest.Mock };
  let gateway: RealtimeGateway;
  const authenticate = (token?: string) => (gateway as any).authenticate(token);

  beforeEach(() => {
    jwt = { verifyAsync: jest.fn(async () => claims) };
    dataSource = { query: jest.fn(async () => [active]) };
    gateway = new RealtimeGateway(jwt as any, {} as any, dataSource as any);
  });

  it('sessão válida conecta e confere só HS256', async () => {
    expect(await authenticate('t')).toEqual({ user: { id: 'u1', organizationId: 'org-1' }, exp: 9999999999 });
    expect(jwt.verifyAsync).toHaveBeenCalledWith('t', { algorithms: ['HS256'] });
  });

  it.each([
    ['token com scope', [active], { ...claims, scope: 'schedule' }],
    ['token sem iat', [active], { ...claims, iat: undefined }],
    ['usuário inativo', [{ ...active, isActive: false }], claims],
    ['usuário inexistente', [], claims],
    ['volante', [{ ...active, systemKey: 'FLOATING_VOLUNTEER' }], claims],
    ['sessão anterior à troca de senha', [{ ...active, passwordChangedAt: new Date(200_000) }], claims],
  ])('recusa %s', async (_label, rows, payload) => {
    jwt.verifyAsync.mockResolvedValue(payload);
    dataSource.query.mockResolvedValue(rows);

    await expect(authenticate('t')).rejects.toThrow('UNAUTHORIZED');
  });
});
