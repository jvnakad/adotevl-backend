import { Resend } from 'resend';
import { MailService } from './mail.service';

const mockSend = jest.fn(async () => ({ data: { id: 'mail-1' }, error: null }));
jest.mock('resend', () => ({ Resend: jest.fn(() => ({ emails: { send: mockSend } })) }));

describe('MailService', () => {
  const originalEnv = { ...process.env };
  let service: MailService;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.RESEND_API_KEY = 're_test';
    process.env.MAIL_FROM = 'AdoteVL <noreply@adotevl.org>';
    process.env.APP_URL = 'https://app.adotevl.org';
    service = new MailService();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('cria o cliente com a chave do ambiente', () => {
    expect(Resend).toHaveBeenCalledWith('re_test');
  });

  it('envia confirmação de conta com link para /confirm', async () => {
    await service.sendConfirmationEmail('ana@teste.com', 'Ana', 'code-123');

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'AdoteVL <noreply@adotevl.org>',
        to: 'ana@teste.com',
        subject: 'Confirme sua conta — AdoteVL',
        html: expect.stringContaining('https://app.adotevl.org/confirm/code-123'),
      }),
    );
  });

  it('envia aprovação com o token no link de acesso', async () => {
    await service.sendApprovalEmail('ana@teste.com', 'Ana', 'jwt-token');

    const [message] = mockSend.mock.calls[0] as any[];
    expect(message.subject).toBe('Sua conta foi aprovada — AdoteVL');
    expect(message.html).toContain('https://app.adotevl.org/signin?token=jwt-token');
    expect(message.html).toContain('Olá, Ana!');
  });

  it('envia a senha temporária no reset', async () => {
    await service.sendPasswordResetEmail('ana@teste.com', 'Ana', 'Ab12Cd34');

    const [message] = mockSend.mock.calls[0] as any[];
    expect(message.subject).toBe('Sua senha foi redefinida — AdoteVL');
    expect(message.html).toContain('Ab12Cd34');
  });

  it('usa remetente e URL padrão quando o ambiente não define', async () => {
    delete process.env.MAIL_FROM;
    delete process.env.APP_URL;

    await service.sendConfirmationEmail('ana@teste.com', 'Ana', 'code-123');

    const [message] = mockSend.mock.calls[0] as any[];
    expect(message.from).toBe('AdoteVL <onboarding@resend.dev>');
    expect(message.html).toContain('http://localhost:5173/confirm/code-123');
  });
});
