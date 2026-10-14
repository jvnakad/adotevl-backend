import { Injectable } from '@nestjs/common';
import { Resend } from 'resend';
import { button, channelList, emailLayout, firstName, highlight, ORG_CHANNELS, paragraph } from './email-layout';

@Injectable()
export class MailService {
  private resend: Resend;

  constructor() {
    this.resend = new Resend(process.env.RESEND_API_KEY);
  }

  private send(to: string, subject: string, html: string) {
    return this.resend.emails.send({
      from: process.env.MAIL_FROM || 'AdoteVL <onboarding@resend.dev>',
      to,
      subject,
      html,
    });
  }

  private appUrl() {
    return process.env.APP_URL || 'http://localhost:5173';
  }

  async sendPasswordResetEmail(to: string, name: string, newPassword: string) {
    await this.send(
      to,
      'Sua senha foi redefinida — AdoteVL',
      emailLayout({
        preheader: 'Use a senha temporária para entrar no sistema.',
        title: `Olá, ${firstName(name)}!`,
        body: [
          paragraph('Sua senha foi redefinida por um administrador. Use a senha temporária abaixo para acessar o sistema:'),
          highlight(newPassword),
          paragraph('Por segurança, troque a senha depois do primeiro acesso.'),
        ].join(''),
      }),
    );
  }

  async sendApprovalEmail(to: string, name: string, token: string) {
    const accessUrl = `${this.appUrl()}/signin?token=${token}`;

    await this.send(
      to,
      'Sua conta foi aprovada — AdoteVL',
      emailLayout({
        preheader: 'Seu acesso ao sistema da Adote foi liberado.',
        eyebrow: 'que alegria!',
        title: `Olá, ${firstName(name)}!`,
        body: [
          paragraph('Sua conta foi aprovada. Agora você faz parte da equipe e já pode acessar o sistema:'),
          button(accessUrl, 'Acessar o sistema'),
          paragraph('O link é de uso único e expira em 8 horas.'),
        ].join(''),
      }),
    );
  }

  async sendConfirmationEmail(to: string, name: string, confirmationCode: string) {
    const confirmUrl = `${this.appUrl()}/confirm/${confirmationCode}`;

    await this.send(
      to,
      'Confirme sua conta — AdoteVL',
      emailLayout({
        preheader: 'Confirme seu e-mail para seguirmos com o seu cadastro.',
        eyebrow: 'quase lá!',
        title: `Olá, ${firstName(name)}!`,
        body: [
          paragraph('Recebemos seu cadastro de voluntário fixo. Confirme seu e-mail para que a equipe possa analisar suas respostas:'),
          button(confirmUrl, 'Confirmar e-mail'),
          paragraph('Se não reconhece este cadastro, ignore este e-mail.'),
        ].join(''),
      }),
    );
  }

  /** Volante não usa o sistema: só boas-vindas e os canais por onde a ONG chama. */
  async sendFloatingWelcomeEmail(to: string, name: string) {
    await this.send(
      to,
      'Boas-vindas ao voluntariado da Adote — AdoteVL',
      emailLayout({
        preheader: 'Que bom ter você com a gente! Veja por onde vamos conversar.',
        eyebrow: 'que bom ter você aqui!',
        title: `Boas-vindas, ${firstName(name)}!`,
        body: [
          paragraph(
            'Agora você é <strong>voluntário volante</strong> da Adote um Vira-Lata. Isso quer dizer que você ajuda quando puder: em eventos, feiras de adoção, mutirões e campanhas.',
          ),
          paragraph('Sempre que precisarmos de uma força, avisamos por estes canais:'),
          channelList([
            {
              title: 'Grupo de voluntários no WhatsApp',
              text: 'Nosso canal principal: avisos de eventos, mutirões e pedidos de ajuda.',
              href: ORG_CHANNELS.whatsappGroup,
              label: 'Entrar no grupo',
            },
            {
              title: `Instagram ${ORG_CHANNELS.instagramHandle}`,
              text: 'Resgates, animais para adoção e o dia a dia do abrigo.',
              href: ORG_CHANNELS.instagram,
              label: 'Seguir a Adote',
            },
            {
              title: `WhatsApp da ONG · ${ORG_CHANNELS.phone}`,
              text: 'Para dúvidas, doações ou para combinar sua participação.',
              href: ORG_CHANNELS.whatsapp,
              label: 'Falar com a gente',
            },
          ]),
          paragraph(`Prefere e-mail? Escreva para <a href="mailto:${ORG_CHANNELS.email}" style="color:#fd5028;font-weight:700;text-decoration:none;">${ORG_CHANNELS.email}</a>.`),
          paragraph('Obrigado por somar com a gente. Cada ajuda muda a história de um vira-lata. 🧡'),
        ].join(''),
      }),
    );
  }
}
