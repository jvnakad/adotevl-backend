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

  /** `hideRecipient`: endereço ainda não confirmado, então a falha de envio registra só o domínio. */
  private async send(to: string, subject: string, html: string, hideRecipient = false) {
    const from = process.env.MAIL_FROM || 'AdoteVL <onboarding@resend.dev>';
    const target = hideRecipient ? `*@${to.split('@')[1] ?? '?'}` : to;
    // A mensagem do provedor costuma repetir o endereço: com `hideRecipient` ele sai dela também
    const mask = (message: unknown) => (hideRecipient ? String(message ?? '').split(to).join(target) : String(message ?? ''));
    try {
      if (this.smtp) {
        await this.smtp.sendMail({ from, to, subject, html });
        return;
      }
      const { error } = (await this.resend.emails.send({ from, to, subject, html })) ?? {};
      if (error) this.logger.error(`E-mail "${subject}" para ${target} não enviado: ${mask(error.message)}`);
    } catch (error) {
      this.logger.error(`E-mail "${subject}" para ${target} não enviado: ${mask((error as Error).message)}`);
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

  /** Código do "Esqueci minha senha". Assunto fixo, sem o código: falha de envio registra o assunto em log (RN-19). */
  async sendPasswordResetCodeEmail(to: string, name: string, code: string) {
    await this.send(
      to,
      'Seu código para redefinir a senha — AdoteVL',
      emailLayout({
        preheader: 'Use o código para criar uma nova senha.',
        title: `Olá, ${firstName(name)}!`,
        body: [
          paragraph('Use este código para criar uma nova senha no sistema:'),
          highlight(code),
          paragraph('Ele vale por 5 minutos. Se pedir outro, use sempre o último.'),
          paragraph('Se não foi você que pediu, ignore este e-mail. Sua senha continua a mesma.'),
        ].join(''),
      }),
    );
  }

  /** Código da troca do próprio e-mail, enviado ao e-mail NOVO. Sem nome (pode ser endereço de outra pessoa) e sem o código no assunto. */
  async sendEmailChangeCodeEmail(to: string, code: string) {
    await this.send(
      to,
      'Seu código para confirmar o novo e-mail — AdoteVL',
      emailLayout({
        preheader: 'Use o código para confirmar a troca de e-mail.',
        title: 'Olá!',
        body: [
          paragraph('Recebemos um pedido para usar este e-mail no acesso ao painel da AdoteVL.'),
          highlight(code),
          paragraph('Ele vale por 5 minutos. Se pedir outro, use sempre o último.'),
          paragraph('Se não foi você, ignore este e-mail. Este endereço não será usado sem o código.'),
        ].join(''),
      }),
      true,
    );
  }

  /** Aviso depois de qualquer troca de senha. Sem senha, código nem token (RN-20). */
  async sendPasswordChangedEmail(to: string, name: string, now = new Date()) {
    const when = now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    await this.send(
      to,
      'Sua senha foi alterada — AdoteVL',
      emailLayout({
        preheader: 'Avisamos por segurança: a senha da sua conta foi alterada.',
        title: `Olá, ${firstName(name)}!`,
        body: [
          paragraph(`A senha da sua conta foi alterada em <strong>${when}</strong> (horário de Brasília).`),
          button(`${this.appUrl()}/signin`, 'Entrar no painel'),
          paragraph(
            `Não foi você? Fale com a gente agora pelo <a href="${ORG_CHANNELS.whatsapp}" style="color:#fd5028;font-weight:700;text-decoration:none;">WhatsApp</a> ou pelo e-mail <a href="mailto:${ORG_CHANNELS.email}" style="color:#fd5028;font-weight:700;text-decoration:none;">${ORG_CHANNELS.email}</a>.`,
          ),
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
      'Seu código para a agenda — AdoteVL',
      emailLayout({
        preheader: 'Use o código para marcar seu voluntariado.',
        title: `Olá, ${firstName(name)}!`,
        body: [
          paragraph('Use este código para marcar seu voluntariado na agenda:'),
          highlight(code),
          paragraph('Ele vale por 5 minutos. Se não foi você que pediu, ignore este e-mail.'),
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
