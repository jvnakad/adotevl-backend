import { Injectable } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class MailService {
  private resend: Resend;

  constructor() {
    this.resend = new Resend(process.env.RESEND_API_KEY);
  }

  async sendConfirmationEmail(to: string, name: string, confirmationCode: string) {
    const confirmUrl = `${process.env.APP_URL || 'http://localhost:5173'}/confirm/${confirmationCode}`;

    await this.resend.emails.send({
      from: process.env.MAIL_FROM || 'AdoteVL <onboarding@resend.dev>',
      to,
      subject: 'Confirme sua conta — AdoteVL',
      html: `
        <h2>Olá, ${name}!</h2>
        <p>Sua conta foi criada no sistema AdoteVL. Clique no link abaixo para confirmar:</p>
        <a href="${confirmUrl}" style="background:#f97316;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">
          Confirmar conta
        </a>
        <p>Se não reconhece este cadastro, ignore este e-mail.</p>
      `,
    });
  }
}
