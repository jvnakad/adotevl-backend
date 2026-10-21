import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { createTransport, Transporter } from 'nodemailer';
import { button, channelList, emailLayout, escapeHtml, firstName, highlight, highlightText, ORG_CHANNELS, paragraph } from './email-layout';
import { formatDateBR } from '../volunteer-schedule/schedule-time';

/**
 * Envio de e-mails. Produção: Resend. Desenvolvimento: `MAIL_DRIVER=smtp` manda para um SMTP local
 * (Mailpit do adotevl-local, caixa em http://localhost:8025) sem precisar de chave.
 * Falha de envio vai para o log e não derruba a ação (cadastro, agenda...).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private resend: Resend;
  private smtp: Transporter | null = null;

  constructor() {
    if (process.env.MAIL_DRIVER === 'smtp') {
      this.smtp = createTransport({ host: process.env.SMTP_HOST || 'localhost', port: Number(process.env.SMTP_PORT) || 1025, secure: false });
    } else {
      this.resend = new Resend(process.env.RESEND_API_KEY);
    }
  }

  private async send(to: string, subject: string, html: string) {
    const from = process.env.MAIL_FROM || 'AdoteVL <onboarding@resend.dev>';
    try {
      if (this.smtp) {
        await this.smtp.sendMail({ from, to, subject, html });
        return;
      }
      const { error } = (await this.resend.emails.send({ from, to, subject, html })) ?? {};
      if (error) this.logger.error(`E-mail "${subject}" para ${to} não enviado: ${error.message}`);
    } catch (error) {
      this.logger.error(`E-mail "${subject}" para ${to} não enviado: ${(error as Error).message}`);
    }
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

  private landingUrl() {
    return (process.env.LANDING_URL || 'http://localhost:4321').replace(/\/$/, '');
  }

  /** Horário marcado na agenda, com o link "Desmarcar" (abre a agenda na LP). */
  async sendShiftConfirmationEmail(to: string, name: string, shift: { date: string; startTime: string; endTime: string; cancelToken: string; institutionName?: string | null; course?: string | null }) {
    const date = formatDateBR(shift.date);
    const cancelUrl = `${this.landingUrl()}/?desmarcar=${shift.cancelToken}#agenda`;
    await this.send(
      to,
      `Voluntariado marcado: ${date} — AdoteVL`,
      emailLayout({
        preheader: `Te esperamos no abrigo em ${date}, das ${shift.startTime} às ${shift.endTime}.`,
        eyebrow: 'te esperamos!',
        title: `Horário marcado, ${firstName(name)}!`,
        body: [
          paragraph(`Seu voluntariado está marcado para <strong>${date}</strong>, das <strong>${shift.startTime} às ${shift.endTime}</strong>.`),
          ...(shift.institutionName && shift.course ? [paragraph(`Programa: <strong>${escapeHtml(shift.institutionName)} · ${escapeHtml(shift.course)}</strong>`)] : []),
          paragraph(`Endereço do abrigo e combinados do dia chegam pelo grupo de voluntários. Dúvidas? Fale com a gente pelo <a href="${ORG_CHANNELS.whatsapp}" style="color:#fd5028;font-weight:700;text-decoration:none;">WhatsApp</a>.`),
          paragraph('Não vai conseguir ir? Desmarque com pelo menos 24h de antecedência:'),
          button(cancelUrl, 'Desmarcar horário'),
        ].join(''),
      }),
    );
  }

  /** Dia trancado pela equipe depois da marcação. */
  async sendShiftCancelledByLockEmail(to: string, name: string, shift: { date: string; startTime: string; endTime: string }, message: string) {
    const date = formatDateBR(shift.date);
    await this.send(
      to,
      `Seu voluntariado de ${date} foi cancelado — AdoteVL`,
      emailLayout({
        preheader: `Não teremos voluntariado em ${date}.`,
        title: `Olá, ${firstName(name)}!`,
        body: [
          paragraph(`Precisamos cancelar o voluntariado de <strong>${date}</strong> (${shift.startTime} às ${shift.endTime}). Recado da equipe:`),
          highlightText(message),
          paragraph('Que tal escolher outro dia? A agenda continua aberta:'),
          button(`${this.landingUrl()}/#agenda`, 'Ver a agenda'),
        ].join(''),
      }),
    );
  }

  /** Código de 6 dígitos para marcar pela LP. */
  async sendScheduleCodeEmail(to: string, name: string, code: string) {
    await this.send(
      to,
      `Seu código para a agenda: ${code} — AdoteVL`,
      emailLayout({
        preheader: 'Use o código para marcar seu voluntariado.',
        title: `Olá, ${firstName(name)}!`,
        body: [
          paragraph('Use este código para marcar seu voluntariado na agenda:'),
          highlight(code),
          paragraph('Ele vale por 10 minutos. Se não foi você que pediu, ignore este e-mail.'),
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
