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

const FID_A = '3f2b8c1e-5a7d-4e9b-8c3a-1d2e3f4a5b6c';
const FID_B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

const fakeSocket = (data: Record<string, unknown>) => {
  const rooms = new Set<string>();
  return {
    data,
    rooms,
    join: jest.fn(async (r: string | string[]) => [r].flat().forEach((x) => rooms.add(x))),
    leave: jest.fn(async (r: string) => void rooms.delete(r)),
    emit: jest.fn(),
    handshake: { auth: {}, headers: {} },
  };
};

describe('RealtimeGateway: família do refresh (fid)', () => {
  let jwt: { verifyAsync: jest.Mock };
  let dataSource: { query: jest.Mock };
  let realtime: { canJoin: jest.Mock };
  let gateway: RealtimeGateway;
  const user = { id: 'u1', organizationId: 'org-1' };

  beforeEach(() => {
    jwt = { verifyAsync: jest.fn(async () => ({ ...claims, fid: FID_A })) };
    dataSource = { query: jest.fn(async () => [{ ...active, familyAlive: true }]) };
    realtime = { canJoin: jest.fn(async () => true) };
    gateway = new RealtimeGateway(jwt as any, realtime as any, dataSource as any);
  });

  it('o handshake guarda o fid e o socket entra em org, user e family', async () => {
    const claimsOut = await (gateway as any).authenticate('t');
    const socket = fakeSocket({ user, exp: claimsOut.exp, fid: claimsOut.fid });

    gateway.handleConnection(socket as any);

    expect(claimsOut.fid).toBe(FID_A);
    expect([...socket.rooms]).toEqual(expect.arrayContaining(['org:org-1', 'user:u1', `family:${FID_A}`]));
    expect(dataSource.query.mock.calls[0][1]).toEqual(['u1', FID_A]);
    gateway.handleDisconnect(socket as any);
  });

  it('access sem fid não entra em room de família', () => {
    const socket = fakeSocket({ user, exp: 9999999999 });

    gateway.handleConnection(socket as any);

    expect([...socket.rooms].some((r) => r.startsWith('family:'))).toBe(false);
    gateway.handleDisconnect(socket as any);
  });

  it('handshake com fid de família revogada recebe UNAUTHORIZED', async () => {
    dataSource.query.mockResolvedValue([{ ...active, familyAlive: false }]);

    await expect((gateway as any).authenticate('t')).rejects.toThrow('UNAUTHORIZED');
  });

  it('room:leave de family:<fid> é ignorado e o socket continua na room (SEC-BUG-01)', async () => {
    const socket = fakeSocket({ user, exp: 9999999999, fid: FID_A });
    gateway.handleConnection(socket as any);

    const ack = await gateway.leave({ room: `family:${FID_A}` }, socket as any);

    expect(ack).toEqual({ ok: true, room: `family:${FID_A}` });
    expect(socket.leave).not.toHaveBeenCalled();
    expect(socket.rooms.has(`family:${FID_A}`)).toBe(true);
    gateway.handleDisconnect(socket as any);
  });

  it('room:leave de uma room de recurso continua saindo', async () => {
    const socket = fakeSocket({ user, exp: 9999999999 });

    await gateway.leave({ room: 'marketing-board:org-1' }, socket as any);

    expect(socket.leave).toHaveBeenCalledWith('marketing-board:org-1');
  });

  it('room:join de family:<fid> é recusado (a regra do canJoin)', async () => {
    realtime.canJoin.mockResolvedValue(false);
    const socket = fakeSocket({ user, exp: 9999999999, fid: FID_A });

    const ack = await gateway.join({ room: `family:${FID_B}` }, socket as any);

    expect(ack).toEqual({ ok: false, error: 'FORBIDDEN', room: `family:${FID_B}` });
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('auth:refresh com outro fid sai da room antiga e entra na nova (CA-70)', async () => {
    const socket = fakeSocket({ user, exp: 9999999999, fid: FID_A });
    gateway.handleConnection(socket as any);
    jwt.verifyAsync.mockResolvedValue({ ...claims, fid: FID_B });

    const ack = await gateway.refresh({ token: 't2' }, socket as any);

    expect(ack).toEqual({ ok: true });
    expect(socket.rooms.has(`family:${FID_A}`)).toBe(false);
    expect(socket.rooms.has(`family:${FID_B}`)).toBe(true);
    expect((socket.data as any).fid).toBe(FID_B);
    gateway.handleDisconnect(socket as any);
  });

  it('auth:refresh com o mesmo fid não mexe nas rooms', async () => {
    const socket = fakeSocket({ user, exp: 9999999999, fid: FID_A });
    gateway.handleConnection(socket as any);
    socket.join.mockClear();

    await gateway.refresh({ token: 't2' }, socket as any);

    expect(socket.join).not.toHaveBeenCalled();
    expect(socket.leave).not.toHaveBeenCalled();
    gateway.handleDisconnect(socket as any);
  });

  it('auth:refresh com fid revogado volta UNAUTHORIZED e não troca de room', async () => {
    const socket = fakeSocket({ user, exp: 9999999999, fid: FID_A });
    gateway.handleConnection(socket as any);
    jwt.verifyAsync.mockResolvedValue({ ...claims, fid: FID_B });
    dataSource.query.mockResolvedValue([{ ...active, familyAlive: false }]);

    const ack = await gateway.refresh({ token: 't2' }, socket as any);

    expect(ack).toEqual({ ok: false, error: 'UNAUTHORIZED' });
    expect((socket.data as any).fid).toBe(FID_A);
    gateway.handleDisconnect(socket as any);
  });
});
