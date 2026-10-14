// Layout único dos e-mails (identidade da LP). Tabelas + estilo inline: Gmail/Outlook ignoram <style> e flex/grid.

/** Canais da ONG. Espelham LP/src/data/site.ts. */
export const ORG_CHANNELS = {
  name: 'Adote um Vira-Lata',
  motto: 'Amor não tem raça',
  instagram: 'https://www.instagram.com/adotevl/',
  instagramHandle: '@adotevl',
  whatsappGroup: 'https://chat.whatsapp.com/Bs5VdS7vnS0HiuaMrXQvnV',
  whatsapp: 'https://wa.me/5541995422456',
  phone: '(41) 99542-2456',
  email: 'adoteumviralatapr@gmail.com',
  // Só a cidade: o endereço do abrigo não vai em e-mail
  city: 'Curitiba/PR',
};

const COLORS = {
  brand: '#fd5028',
  brandDark: '#d83a16',
  ink: '#394553',
  inkSoft: '#5b6878',
  inkDeep: '#19272e',
  cream50: '#fbf6ee',
  cream100: '#f5ecdc',
  cream200: '#e8d8bf',
  bege100: '#f2ecd2',
};

const FONT = "'Outfit', 'Segoe UI', Helvetica, Arial, sans-serif";
const DISPLAY = "'Baloo 2', 'Trebuchet MS', 'Segoe UI', Helvetica, Arial, sans-serif";

/** Texto vindo do usuário (nome do cadastro) vira HTML seguro. */
export const escapeHtml = (value: string) =>
  String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export const firstName = (fullName: string) => escapeHtml(String(fullName ?? '').trim().split(/\s+/)[0] ?? '');

export const paragraph = (html: string) =>
  `<p style="margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:1.6;color:${COLORS.ink};">${html}</p>`;

export const button = (href: string, label: string) => `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
    <tr>
      <td style="border-radius:999px;background:${COLORS.brand};border-bottom:3px solid ${COLORS.brandDark};">
        <a href="${href}" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px;">${label}</a>
      </td>
    </tr>
  </table>`;

/** Destaque (código, senha temporária). */
export const highlight = (text: string) => `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
    <tr>
      <td style="background:${COLORS.cream100};border:1px dashed ${COLORS.cream200};border-radius:12px;padding:14px 22px;font-family:'Courier New',monospace;font-size:22px;font-weight:700;letter-spacing:3px;color:${COLORS.inkDeep};">${escapeHtml(text)}</td>
    </tr>
  </table>`;

/** Lista de canais com título, descrição e link. */
export const channelList = (items: { title: string; text: string; href: string; label: string }[]) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 24px;">
    ${items
      .map(
        (item) => `
    <tr>
      <td style="padding:14px 16px;background:${COLORS.cream50};border:1px solid ${COLORS.cream200};border-radius:16px;">
        <p style="margin:0 0 4px;font-family:${DISPLAY};font-size:17px;font-weight:700;color:${COLORS.inkDeep};">${item.title}</p>
        <p style="margin:0 0 6px;font-family:${FONT};font-size:14px;line-height:1.5;color:${COLORS.inkSoft};">${item.text}</p>
        <a href="${item.href}" style="font-family:${FONT};font-size:14px;font-weight:700;color:${COLORS.brand};text-decoration:none;">${item.label} &rarr;</a>
      </td>
    </tr>
    <tr><td style="height:10px;line-height:10px;font-size:0;">&nbsp;</td></tr>`,
      )
      .join('')}
  </table>`;

type LayoutOptions = {
  /** Texto de pré-visualização na caixa de entrada */
  preheader: string;
  /** Título grande (já escapado) */
  title: string;
  /** Linha manuscrita acima do título */
  eyebrow?: string;
  /** Corpo em HTML (use paragraph/button/...) */
  body: string;
};

export function emailLayout({ preheader, title, eyebrow, body }: LayoutOptions) {
  const landing = (process.env.LANDING_URL || 'http://localhost:4321').replace(/\/$/, '');
  const year = new Date().getFullYear();
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light only">
  <title>${title}</title>
  <link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@700;800&family=Outfit:wght@400;600;700&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:${COLORS.cream50};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLORS.cream50};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
          <tr>
            <td align="center" style="padding:0 0 20px;">
              <a href="${landing}" style="text-decoration:none;">
                <img src="${landing}/email/logo.png" width="140" alt="${ORG_CHANNELS.name}" style="display:block;width:140px;height:auto;border:0;font-family:${DISPLAY};font-size:22px;font-weight:800;color:${COLORS.brand};">
              </a>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;border:1px solid ${COLORS.cream200};border-radius:28px;padding:36px 32px 12px;">
              ${eyebrow ? `<p style="margin:0 0 4px;font-family:'Caveat','Comic Sans MS',cursive;font-size:22px;color:${COLORS.brand};">${eyebrow}</p>` : ''}
              <h1 style="margin:0 0 20px;font-family:${DISPLAY};font-size:28px;line-height:1.2;font-weight:800;color:${COLORS.inkDeep};">${title}</h1>
              ${body}
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:24px 16px 8px;">
              <p style="margin:0 0 10px;font-family:'Caveat','Comic Sans MS',cursive;font-size:22px;color:${COLORS.brand};">${ORG_CHANNELS.motto}</p>
              <p style="margin:0 0 6px;font-family:${FONT};font-size:13px;line-height:1.6;color:${COLORS.inkSoft};">
                <a href="${ORG_CHANNELS.instagram}" style="color:${COLORS.ink};font-weight:700;text-decoration:none;">Instagram</a>
                &nbsp;·&nbsp;
                <a href="${ORG_CHANNELS.whatsapp}" style="color:${COLORS.ink};font-weight:700;text-decoration:none;">WhatsApp</a>
                &nbsp;·&nbsp;
                <a href="mailto:${ORG_CHANNELS.email}" style="color:${COLORS.ink};font-weight:700;text-decoration:none;">E-mail</a>
                &nbsp;·&nbsp;
                <a href="${landing}" style="color:${COLORS.ink};font-weight:700;text-decoration:none;">Site</a>
              </p>
              <p style="margin:0;font-family:${FONT};font-size:12px;line-height:1.6;color:${COLORS.inkSoft};">
                Associação ${ORG_CHANNELS.name} · ${ORG_CHANNELS.city}<br>© ${year}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
