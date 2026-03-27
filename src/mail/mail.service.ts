import { Injectable } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class MailService {
  private resend: Resend;

  constructor() {
    this.resend = new Resend(process.env.RESEND_API_KEY);
  }

  async sendPasswordResetEmail(to: string, name: string, newPassword: string) {
    await this.resend.emails.send({
      from: process.env.MAIL_FROM || 'AdoteVL <onboarding@resend.dev>',
      to,
      subject: 'Sua senha foi redefinida — AdoteVL',
      html: `
        <h2>Olá, ${name}!</h2>
        <p>Sua senha foi redefinida pelo administrador. Use a senha temporária abaixo para acessar o sistema:</p>
        <p style="font-size:20px;font-weight:bold;letter-spacing:2px;">${newPassword}</p>
        <p>Por segurança, altere sua senha após o primeiro acesso.</p>
      `,
    });
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
