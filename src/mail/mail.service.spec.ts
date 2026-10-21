import { Resend } from 'resend';
import { MailService } from './mail.service';

const mockSend = jest.fn(async () => ({ data: { id: 'mail-1' }, error: null }));
jest.mock('resend', () => ({ Resend: jest.fn(() => ({ emails: { send: mockSend } })) }));

const mockSendMail = jest.fn(async () => ({ messageId: 'smtp-1' }));
const mockCreateTransport = jest.fn(() => ({ sendMail: mockSendMail }));
jest.mock('nodemailer', () => ({ createTransport: (...args: unknown[]) => (mockCreateTransport as any)(...args) }));

describe('MailService', () => {
  const originalEnv = { ...process.env };
  let service: MailService;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.RESEND_API_KEY = 're_test';
    process.env.MAIL_FROM = 'AdoteVL <noreply@adotevl.org>';
    process.env.APP_URL = 'https://app.adotevl.org';
    process.env.LANDING_URL = 'https://adotevl.org';
    delete process.env.MAIL_DRIVER;
    delete process.env.EMAIL_ASSET_URL;
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
        expect(message.html).toContain('Curitiba/PR');
        expect(message.html).not.toContain('Rua ');
      }
    });

    it('EMAIL_ASSET_URL troca só a origem do logo (links seguem a LANDING_URL)', async () => {
      process.env.EMAIL_ASSET_URL = 'https://lp-adoteapp.netlify.app/';

      await service.sendShiftConfirmationEmail('isa@teste.com', 'Isa', { date: '2026-10-20', startTime: '09:00', endTime: '14:00', cancelToken: 'tok' });

      const [message] = mockSend.mock.calls[0] as any[];
      expect(message.html).toContain('src="https://lp-adoteapp.netlify.app/email/logo.png"');
      expect(message.html).toContain('https://adotevl.org/?desmarcar=tok#agenda');
    });

    it('escapa o nome digitado no cadastro (HTML no e-mail)', async () => {
      await service.sendFloatingWelcomeEmail('x@teste.com', '<img src=x onerror=alert(1)>');

      const [message] = mockSend.mock.calls[0] as any[];
      expect(message.html).not.toContain('<img src=x');
      expect(message.html).toContain('&lt;img');
    });
  });

  describe('agenda de voluntariado', () => {
    const shift = { date: '2026-10-20', startTime: '09:00', endTime: '14:00', cancelToken: 'tok-123' };

    it('confirmação do horário traz data, horário e o link de desmarcar na LP', async () => {
      await service.sendShiftConfirmationEmail('isa@teste.com', 'Isa Kaori', shift);

      const [message] = mockSend.mock.calls[0] as any[];
      expect(message.subject).toBe('Voluntariado marcado: 20/10/2026 — AdoteVL');
      expect(message.html).toContain('20/10/2026');
      expect(message.html).toContain('09:00 às 14:00');
      expect(message.html).toContain('https://adotevl.org/?desmarcar=tok-123#agenda');
      expect(message.html).toContain('24h');
    });

    it('confirmação do programa da faculdade traz "Programa: faculdade · curso" (escapado); sem programa a linha some', async () => {
      await service.sendShiftConfirmationEmail('isa@teste.com', 'Isa Kaori', { ...shift, institutionName: 'PUCPR', course: 'Direito <b>' });
      await service.sendShiftConfirmationEmail('isa@teste.com', 'Isa Kaori', { ...shift, institutionName: null, course: null });

      const [withProgram, without] = (mockSend.mock.calls as any[]).map(([message]) => message.html as string);
      expect(withProgram).toContain('Programa: <strong>PUCPR · Direito &lt;b&gt;</strong>');
      expect(without).not.toContain('Programa:');
    });

    it('dia trancado avisa com a mensagem da equipe', async () => {
      await service.sendShiftCancelledByLockEmail('isa@teste.com', 'Isa Kaori', shift, 'Mutirão de castração');

      const [message] = mockSend.mock.calls[0] as any[];
      expect(message.subject).toBe('Seu voluntariado de 20/10/2026 foi cancelado — AdoteVL');
      expect(message.html).toContain('Mutirão de castração');
    });

    it('código para marcar pela LP', async () => {
      await service.sendScheduleCodeEmail('isa@teste.com', 'Isa Kaori', '482913');

      const [message] = mockSend.mock.calls[0] as any[];
      expect(message.subject).toBe('Seu código para a agenda: 482913 — AdoteVL');
      expect(message.html).toContain('482913');
      expect(message.html).toContain('10 minutos');
    });
  });

  describe('ambiente de desenvolvimento', () => {
    it('MAIL_DRIVER=smtp envia pelo SMTP local (Mailpit) e não pelo Resend', async () => {
      process.env.MAIL_DRIVER = 'smtp';
      process.env.SMTP_HOST = 'mailpit';
      process.env.SMTP_PORT = '1025';
      const local = new MailService();

      await local.sendScheduleCodeEmail('isa@teste.com', 'Isa', '482913');

      expect(mockCreateTransport).toHaveBeenCalledWith({ host: 'mailpit', port: 1025, secure: false });
      expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({ from: 'AdoteVL <noreply@adotevl.org>', to: 'isa@teste.com', subject: 'Seu código para a agenda: 482913 — AdoteVL' }));
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('falha do Resend vai para o log em vez de sumir', async () => {
      const log = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
      mockSend.mockResolvedValueOnce({ data: null, error: { name: 'validation_error', message: 'API key is invalid' } } as any);

      await service.sendScheduleCodeEmail('isa@teste.com', 'Isa', '482913');

      expect(log).toHaveBeenCalledWith(expect.stringContaining('API key is invalid'));
    });
  });
});
