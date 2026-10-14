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
    process.env.LANDING_URL = 'https://adotevl.org';
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

  describe('boas-vindas do volante', () => {
    it('apresenta os canais da ONG, sem senha nem link de acesso', async () => {
      await service.sendFloatingWelcomeEmail('bia@teste.com', 'Bia Souza');

      const [message] = mockSend.mock.calls[0] as any[];
      expect(message.to).toBe('bia@teste.com');
      expect(message.subject).toBe('Boas-vindas ao voluntariado da Adote — AdoteVL');
      expect(message.html).toContain('Bia');
      expect(message.html).toContain('https://chat.whatsapp.com/Bs5VdS7vnS0HiuaMrXQvnV');
      expect(message.html).toContain('https://www.instagram.com/adotevl/');
      expect(message.html).toContain('https://wa.me/5541995422456');
      expect(message.html).not.toMatch(/senha/i);
      expect(message.html).not.toContain('https://app.adotevl.org');
    });
  });

  describe('template padrão', () => {
    it('todos os e-mails usam o layout com o logo hospedado na LP', async () => {
      await service.sendConfirmationEmail('ana@teste.com', 'Ana', 'code-123');
      await service.sendApprovalEmail('ana@teste.com', 'Ana', 'jwt');
      await service.sendPasswordResetEmail('ana@teste.com', 'Ana', 'Ab12Cd34');
      await service.sendFloatingWelcomeEmail('ana@teste.com', 'Ana');

      for (const [message] of mockSend.mock.calls as any[]) {
        expect(message.html).toContain('src="https://adotevl.org/email/logo.png"');
        expect(message.html).toContain('Amor não tem raça');
      }
    });

    it('escapa o nome digitado no cadastro (HTML no e-mail)', async () => {
      await service.sendFloatingWelcomeEmail('x@teste.com', '<img src=x onerror=alert(1)>');

      const [message] = mockSend.mock.calls[0] as any[];
      expect(message.html).not.toContain('<img src=x');
      expect(message.html).toContain('&lt;img');
    });
  });
});
