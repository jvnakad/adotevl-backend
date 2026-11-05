// Seed do Marketing para TESTE LOCAL: equipe Marketing com usuários, etiquetas e cards em todas as filas,
// com prazos (atrasados, hoje, próximos, sem prazo), subtarefas, anexos, comentários com menção, movimentações e arquivados.
// Uso: npm run seed:marketing [-- --org=<id ou CNPJ>] [-- --reset]
//   --org=<id|cnpj>  organização alvo (padrão: a primeira organização existente)
//   --reset          apaga SÓ os dados do Marketing da organização alvo (cards, etiquetas, histórico, filas) e recria
// Idempotente: se a organização já tem cards de Marketing, não faz nada (use --reset para recriar).
// Só roda com o banco em localhost/127.0.0.1 (ou, na stack Docker local, no serviço do compose com ALLOW_LOCAL_SEED=1) e fora de produção.
// Senha dos usuários criados: 123456.
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { deflateSync } from 'zlib';
import { AppModule } from '../src/app.module';
import { User } from '../src/user/user.entity';
import { TeamService } from '../src/team/team.service';
import { TeamSystemKey } from '../src/team/team.entity';
import { TeamMembershipService } from '../src/team/team-membership.service';
import { AccessLevel, Screen } from '../src/access/access';
import { MarketingListService } from '../src/marketing/marketing-list.service';
import { MarketingLabelService } from '../src/marketing/marketing-label.service';
import { MarketingCardService } from '../src/marketing/marketing-card.service';
import { MarketingTaskService } from '../src/marketing/marketing-task.service';
import { MarketingCommentService } from '../src/marketing/marketing-comment.service';
import { MarketingAttachmentService } from '../src/marketing/marketing-attachment.service';
import { addDays, todayInBrazil } from '../src/volunteer-schedule/schedule-time';

const DAY = 86_400_000;
const PASSWORD = '123456';

function assertLocal() {
  if (process.env.NODE_ENV === 'production') throw new Error('seed:marketing não roda com NODE_ENV=production.');
  let host = '';
  try {
    host = new URL(process.env.DATABASE_URL ?? '').hostname;
  } catch {
    // DATABASE_URL ausente ou inválida cai na recusa abaixo
  }
  const isLoopback = host === 'localhost' || host === '127.0.0.1';
  // Mesmo critério do seed:stock: nome de serviço do compose só com ALLOW_LOCAL_SEED=1 e host de um rótulo só
  const isComposeService = process.env.ALLOW_LOCAL_SEED === '1' && /^[a-z][a-z0-9_-]*$/i.test(host);
  if (!isLoopback && !isComposeService) {
    throw new Error(
      `seed:marketing só roda com DATABASE_URL apontando para localhost ou 127.0.0.1 (host atual: "${host || 'indefinido'}"). ` +
        'Na stack Docker local, ALLOW_LOCAL_SEED=1 libera o nome do serviço do banco (ex.: db).',
    );
  }
}

const argValue = (name: string) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

// ------------------------------------------------------------
// Anexos gerados na hora (PNG em gradiente e PDF mínimo), sem depender de internet
// ------------------------------------------------------------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf: Buffer) => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};
const rgb = (color: string) => [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));

function gradientPng(from: string, to: string, width = 640, height = 400) {
  const [r1, g1, b1] = rgb(from);
  const [r2, g2, b2] = rgb(to);
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) {
      const t = (x + y) / (width + height);
      const offset = row + 1 + x * 3;
      raw[offset] = Math.round(r1 + (r2 - r1) * t);
      raw[offset + 1] = Math.round(g1 + (g2 - g1) * t);
      raw[offset + 2] = Math.round(b1 + (b2 - b1) * t);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits por canal
  header[9] = 2; // RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function minimalPdf(title: string) {
  const text = title.replace(/[()\\]/g, '');
  const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

const asUpload = (originalname: string, buffer: Buffer, mimetype: string) =>
  ({ fieldname: 'files', originalname, encoding: '7bit', mimetype, buffer, size: buffer.length }) as Express.Multer.File;

// ------------------------------------------------------------
// Dados
// ------------------------------------------------------------
// Usuários do Marketing: [chave, nome, e-mail, cpf]
const MARKETING_USERS: [string, string, string, string][] = [
  ['marina', 'Marina Marketing', 'marketing@adotevl.local', '40012345644'],
  ['caio', 'Caio Criação', 'criacao@adotevl.local', '40023456701'],
  ['rita', 'Rita Redes Sociais', 'redes@adotevl.local', '40034567852'],
];
// Só Visualizar no Marketing (equipe própria "Diretoria")
const VIEWER: [string, string, string] = ['Diego Diretoria', 'diretoria@adotevl.local', '40045678901'];

// Etiquetas: [chave, nome, cor da paleta do design]
const LABELS: [string, string, string][] = [
  ['insta', 'Instagram', '#C11574'],
  ['face', 'Facebook', '#1570EF'],
  ['tiktok', 'TikTok', '#101828'],
  ['site', 'Site', '#15B79E'],
  ['urgente', 'Urgente', '#D92D20'],
  ['campanha', 'Campanha', '#FB6514'],
  ['adocao', 'Adoção', '#027A48'],
  ['evento', 'Evento', '#6938EF'],
  ['doacao', 'Doação', '#FDB022'],
];

type ListKey = 'releases' | 'ideias' | 'pautas' | 'criacao' | 'ajustes' | 'aprovacao' | 'postado';
const LIST_NAMES: Record<ListKey, string> = {
  releases: 'Releases',
  ideias: 'Banco de Ideias',
  pautas: 'Pautas',
  criacao: 'Criação',
  ajustes: 'Ajustes',
  aprovacao: 'Aprovação',
  postado: 'Postado',
};

interface CardSeed {
  title: string;
  list: ListKey;
  createdDaysAgo: number;
  /** filas por onde o card passou antes da atual (gera CARD_MOVIDO no histórico) */
  path?: ListKey[];
  description?: string;
  due?: number | null; // dias a partir de hoje (negativo = atrasado)
  publish?: number | null;
  members?: string[];
  labels?: string[];
  tasks?: [string, boolean, string?][]; // [título, concluída, responsável]
  comments?: [string, string, string[]?][]; // [autor, texto, mencionados]
  files?: ('png' | 'pdf')[];
  archived?: boolean;
}

const LONG_TITLE =
  'Arte_do_cartaz_da_feira_de_adocao_de_dezembro_versao_final_aprovada_pela_diretoria_com_logos_dos_parceiros_v12';
const LONG_DESCRIPTION =
  'Briefing: campanha de fim de ano para incentivar a adoção responsável de cães adultos e idosos.\n\n' +
  'Público: famílias da região, 25 a 45 anos. Tom acolhedor, sem apelo de pena.\n' +
  'Peças: 3 posts no feed, 5 stories, 1 reels de 30 s e banner do site.\n\n' +
  'Referências: https://www.instagram.com/explore/tags/adotenaocompre/ e a campanha do ano passado (pasta compartilhada).\n' +
  'Prazo de aprovação com a diretoria: até sexta. Qualquer dúvida, falar com a Marina.';

const CARDS: CardSeed[] = [
  // Releases
  { title: 'Release: balanço de adoções do trimestre', list: 'releases', createdDaysAgo: 20, due: 3, publish: 6, members: ['marina'], labels: ['site'], tasks: [['Levantar números com a equipe de adoção', true, 'marina'], ['Escrever texto', false, 'marina'], ['Revisão da diretoria', false]] },
  { title: 'Release para imprensa local: feira de dezembro', list: 'releases', createdDaysAgo: 12, due: -2, members: ['marina', 'rita'], labels: ['evento', 'urgente'], comments: [['rita', '@Marina Marketing já mandei a lista de contatos dos jornais.', ['marina']]] },
  { title: 'Nota oficial: nova parceria com clínica veterinária', list: 'releases', createdDaysAgo: 5, due: 10, labels: ['site', 'face'] },

  // Banco de Ideias
  { title: 'Série "Antes e depois" de pets adotados', list: 'ideias', createdDaysAgo: 40, members: ['rita'], labels: ['insta', 'adocao'] },
  { title: 'Live com veterinário sobre castração', list: 'ideias', createdDaysAgo: 35, labels: ['insta', 'evento'] },
  { title: 'Desafio no TikTok: truques dos pets da ONG', list: 'ideias', createdDaysAgo: 30, members: ['caio'], labels: ['tiktok'] },
  { title: 'Newsletter mensal para padrinhos', list: 'ideias', createdDaysAgo: 28, labels: ['site', 'doacao'] },
  { title: 'Calendário 2027 com fotos dos resgatados', list: 'ideias', createdDaysAgo: 25, members: ['caio', 'marina'], labels: ['campanha', 'doacao'], description: 'Vender na feira e no site. Ver orçamento da gráfica parceira.' },
  { title: 'Parceria com pet shops do bairro', list: 'ideias', createdDaysAgo: 22, labels: ['campanha'] },
  { title: 'Post sobre adoção de gatos pretos', list: 'ideias', createdDaysAgo: 15, labels: ['insta', 'adocao'] },
  { title: 'Ideia sem etiqueta nem membro', list: 'ideias', createdDaysAgo: 2 },

  // Pautas: mais de 20 para testar o "Ver mais"
  ...Array.from({ length: 26 }, (_, i): CardSeed => {
    const themes = ['Dica de cuidado', 'Pet da semana', 'Mito ou verdade', 'Depoimento de adotante', 'Bastidores do abrigo', 'Lembrete de vacinação'];
    const theme = themes[i % themes.length];
    const due = i % 5 === 0 ? null : i % 7 === 0 ? -((i % 4) + 1) : (i % 9) + 1;
    return {
      title: `${theme} #${i + 1}`,
      list: 'pautas',
      createdDaysAgo: 50 - i,
      due,
      publish: due === null ? null : due + 2,
      members: [['rita'], ['marina'], ['caio'], ['rita', 'caio'], []][i % 5],
      labels: [['insta'], ['face'], ['insta', 'face'], ['tiktok'], ['site'], []][i % 6],
      tasks: i % 4 === 0 ? [['Definir texto', i % 8 === 0], ['Escolher foto', false]] : undefined,
    };
  }),
  { title: 'Pauta urgente: pet desaparecido na região', list: 'pautas', createdDaysAgo: 1, due: 0, members: ['rita'], labels: ['urgente', 'insta', 'face'] },

  // Criação
  { title: 'Arte da campanha de Natal', list: 'criacao', createdDaysAgo: 18, path: ['ideias', 'pautas'], due: 4, publish: 8, members: ['caio'], labels: ['campanha', 'insta'], description: LONG_DESCRIPTION, tasks: [['Moodboard', true, 'caio'], ['Rascunho do post', true, 'caio'], ['Versão para stories', false, 'caio'], ['Versão para o site', false]], files: ['png', 'pdf'], comments: [['marina', 'Ficou ótimo o moodboard! @Caio Criação, pode seguir.', ['caio']], ['caio', 'Combinado, subo o rascunho amanhã.']] },
  { title: 'Vídeo reels: um dia no abrigo', list: 'criacao', createdDaysAgo: 14, path: ['pautas'], due: -5, members: ['caio', 'rita'], labels: ['insta', 'tiktok'], tasks: [['Roteiro', true], ['Gravação', false, 'caio'], ['Edição', false, 'caio']] },
  { title: 'Carrossel: 5 sinais de que seu pet precisa de veterinário', list: 'criacao', createdDaysAgo: 9, path: ['pautas'], due: 1, members: ['caio'], labels: ['insta'], files: ['png'] },
  { title: LONG_TITLE, list: 'criacao', createdDaysAgo: 7, due: 2, members: ['caio', 'marina', 'rita'], labels: ['evento', 'campanha', 'insta', 'face', 'site'] },
  { title: 'Banner do site: doações de ração', list: 'criacao', createdDaysAgo: 4, due: 6, labels: ['site', 'doacao'] },

  // Ajustes
  { title: 'Ajustar cores do post de adoção (feedback diretoria)', list: 'ajustes', createdDaysAgo: 16, path: ['pautas', 'criacao', 'aprovacao'], due: -1, members: ['caio'], labels: ['adocao', 'insta'], comments: [['marina', 'A diretoria pediu para trocar o laranja por um tom mais escuro.'], ['caio', 'Feito, @Marina Marketing. Pode revisar?', ['marina']]] },
  { title: 'Corrigir telefone no flyer da feira', list: 'ajustes', createdDaysAgo: 6, path: ['criacao'], due: 0, members: ['caio'], labels: ['evento', 'urgente'], files: ['pdf'] },
  { title: 'Legendas do vídeo institucional', list: 'ajustes', createdDaysAgo: 3, path: ['criacao'], due: 5, members: ['rita'], labels: ['site'] },

  // Aprovação
  { title: 'Post: campanha de padrinhos', list: 'aprovacao', createdDaysAgo: 21, path: ['ideias', 'pautas', 'criacao'], due: 2, publish: 3, members: ['marina'], labels: ['doacao', 'insta'], files: ['png'], tasks: [['Arte', true], ['Legenda', true], ['Aprovação da diretoria', false, 'marina']] },
  { title: 'Stories: agenda de vacinação gratuita', list: 'aprovacao', createdDaysAgo: 10, path: ['pautas', 'criacao'], due: -3, members: ['rita', 'marina'], labels: ['insta', 'urgente'] },
  { title: 'E-mail para padrinhos de novembro', list: 'aprovacao', createdDaysAgo: 8, path: ['pautas', 'criacao'], due: 7, labels: ['site', 'doacao'] },

  // Postado (fila final: prazo vencido não conta como atrasado)
  ...Array.from({ length: 9 }, (_, i): CardSeed => ({
    title: ['Post: Thor foi adotado!', 'Stories da feira de outubro', 'Reels: banho no abrigo', 'Post: obrigado, padrinhos', 'Carrossel: guia de adoção', 'Post: Luna procura um lar', 'Live: castração (gravação)', 'Banner: Outubro Rosa pet', 'Post: balanço de setembro'][i],
    list: 'postado',
    createdDaysAgo: 60 - i * 5,
    path: ['pautas', 'criacao', 'aprovacao'],
    due: -(20 - i * 2),
    publish: -(18 - i * 2),
    members: [['caio'], ['rita'], ['caio', 'rita'], ['marina']][i % 4],
    labels: [['adocao', 'insta'], ['evento', 'insta'], ['tiktok'], ['doacao', 'face']][i % 4],
  })),

  // Arquivados (para a página de arquivados)
  { title: 'Campanha cancelada: rifa de agosto', list: 'pautas', createdDaysAgo: 45, labels: ['campanha'], archived: true },
  { title: 'Post duplicado: dia dos animais', list: 'criacao', createdDaysAgo: 33, labels: ['insta'], archived: true },
  { title: 'Ideia antiga: podcast da ONG', list: 'ideias', createdDaysAgo: 55, archived: true },
];

async function main() {
  // Antes de subir a aplicação (o synchronize mexeria no banco): importar o AppModule já carregou o .env.local em process.env
  assertLocal();
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });

  const dataSource = app.get(DataSource);
  const teams = app.get(TeamService);
  const membership = app.get(TeamMembershipService);
  const lists = app.get(MarketingListService, { strict: false });
  const labels = app.get(MarketingLabelService, { strict: false });
  const cards = app.get(MarketingCardService, { strict: false });
  const tasks = app.get(MarketingTaskService, { strict: false });
  const comments = app.get(MarketingCommentService, { strict: false });
  const attachments = app.get(MarketingAttachmentService, { strict: false });

  // ---- organização e admin (autor das ações de configuração)
  const orgArg = argValue('org');
  const orgs: { id: string; legal_name: string }[] = orgArg
    ? await dataSource.query('SELECT id, legal_name FROM organizations WHERE id::text = $1 OR cnpj = $1', [orgArg])
    : await dataSource.query('SELECT id, legal_name FROM organizations ORDER BY created_at ASC LIMIT 1');
  if (!orgs.length) throw new Error(orgArg ? `Organização "${orgArg}" não encontrada.` : 'Nenhuma organização encontrada. Rode npm run seed:dev antes.');
  const orgId = orgs[0].id;
  const orgName = orgs[0].legal_name;

  const adminTeam = await teams.ensureDefaultTeams(orgId);
  const admins: { id: string; full_name: string }[] = await dataSource.query(
    `SELECT u.id, u.full_name FROM users u JOIN volunteers v ON v.user_id = u.id
      WHERE u.organization_id = $1 AND u."isActive" = true AND v.is_active AND v.team_id = $2 ORDER BY u.created_at ASC LIMIT 1`,
    [orgId, adminTeam.id],
  );
  if (!admins.length) throw new Error(`A organização "${orgName}" não tem usuário ativo na equipe Admin.`);
  const admin = admins[0];

  // ---- idempotência e reset
  const [had] = await dataSource.query(
    `SELECT (SELECT count(*)::int FROM marketing_cards WHERE organization_id = $1) AS cards,
            (SELECT count(*)::int FROM marketing_labels WHERE organization_id = $1) AS labels`,
    [orgId],
  );
  if (process.argv.includes('--reset')) {
    console.warn(`ATENÇÃO: --reset apaga os dados do Marketing da organização "${orgName}" (${had.cards} cards, ${had.labels} etiquetas, histórico e filas).`);
    await dataSource.transaction(async (manager) => {
      const cardIds = `SELECT id FROM marketing_cards WHERE organization_id = $1`;
      await manager.query(`DELETE FROM marketing_history_events WHERE organization_id = $1`, [orgId]);
      await manager.query(`DELETE FROM marketing_card_comments WHERE card_id IN (${cardIds})`, [orgId]);
      await manager.query(`DELETE FROM marketing_card_tasks WHERE card_id IN (${cardIds})`, [orgId]);
      await manager.query(`DELETE FROM marketing_card_labels WHERE card_id IN (${cardIds})`, [orgId]);
      await manager.query(`DELETE FROM marketing_card_members WHERE card_id IN (${cardIds})`, [orgId]);
      await manager.query(`UPDATE marketing_cards SET cover_attachment_id = NULL WHERE organization_id = $1`, [orgId]);
      await manager.query(`DELETE FROM marketing_card_attachments WHERE card_id IN (${cardIds})`, [orgId]);
      await manager.query(`DELETE FROM marketing_cards WHERE organization_id = $1`, [orgId]);
      await manager.query(`DELETE FROM marketing_labels WHERE organization_id = $1`, [orgId]);
      await manager.query(`DELETE FROM marketing_lists WHERE organization_id = $1`, [orgId]);
      // Notificações do Marketing (tabela da Fase 2; pode não existir)
      const [{ exists }] = await manager.query(`SELECT to_regclass('public.notifications') IS NOT NULL AS exists`);
      if (exists) await manager.query(`DELETE FROM notifications WHERE organization_id = $1 AND link LIKE '/marketing%'`, [orgId]);
    });
  } else if (had.cards > 0) {
    console.log(`A organização "${orgName}" já tem ${had.cards} cards de Marketing. Nada foi feito; use --reset para recriar.`);
    await app.close();
    return;
  }

  // ---- usuários e equipes
  const profile = (await dataSource.query(`SELECT id FROM profiles WHERE name = 'VOLUNTEER' LIMIT 1`))[0];
  if (!profile) throw new Error('Perfil VOLUNTEER não encontrado. Suba a API uma vez antes do seed.');
  const password = await bcrypt.hash(PASSWORD, 10);
  const userRepo = dataSource.getRepository(User);
  // Usuário já existente com o e-mail é reaproveitado (o seed não troca senha nem dados)
  const ensureUser = async (fullName: string, email: string, cpf: string) =>
    (await userRepo.findOne({ where: { email } })) ??
    userRepo.save(
      userRepo.create({
        fullName,
        cpf,
        email,
        phone: '11900000000',
        birthDate: new Date('1995-05-10'),
        password,
        profileId: profile.id,
        organizationId: orgId,
        isConfirmed: true,
        isApproved: true,
        isActive: true,
      }),
    );
  const asMember = (user: User) => ({ id: user.id, fullName: user.fullName, cpf: user.cpf, birthDate: user.birthDate, organizationId: user.organizationId });

  const marketingTeam = await teams.systemTeam(orgId, TeamSystemKey.MARKETING);
  const userIds: Record<string, string> = {};
  for (const [key, name, email, cpf] of MARKETING_USERS) {
    const user = await ensureUser(name, email, cpf);
    await membership.assign(asMember(user), marketingTeam.id, admin.id);
    userIds[key] = user.id;
  }

  const boardTeamName = 'Diretoria';
  let boardTeam = (await dataSource.query(`SELECT id FROM teams WHERE organization_id = $1 AND name = $2`, [orgId, boardTeamName]))[0];
  if (!boardTeam) boardTeam = await teams.create({ name: boardTeamName } as never, orgId, admin.id);
  await teams.setPermissions(boardTeam.id, { [Screen.MARKETING]: AccessLevel.VIEW }, admin.id);
  const viewer = await ensureUser(...VIEWER);
  await membership.assign(asMember(viewer), boardTeam.id, admin.id);

  // ---- filas e etiquetas
  await lists.ensureDefaultLists(orgId);
  const listRows: { id: string; name: string }[] = await dataSource.query(`SELECT id, name FROM marketing_lists WHERE organization_id = $1 AND is_active`, [orgId]);
  const listIds = Object.fromEntries(
    (Object.keys(LIST_NAMES) as ListKey[]).map((key) => {
      const row = listRows.find((list) => list.name === LIST_NAMES[key]);
      if (!row) throw new Error(`Fila "${LIST_NAMES[key]}" não encontrada. Rode com --reset para recriar as filas padrão.`);
      return [key, row.id];
    }),
  ) as Record<ListKey, string>;

  const labelIds: Record<string, string> = {};
  for (const [key, name, color] of LABELS) {
    const label = await labels.create({ name, color }, admin.id, orgId);
    labelIds[key] = label.id;
  }

  // ---- cards: cada um roda em ordem cronológica e as datas são levadas para o passado depois
  const now = Date.now();
  const today = todayInBrazil();
  const day = (offset: number | null | undefined) => (offset === null || offset === undefined ? null : addDays(today, offset));
  const palette = [
    ['#FB6514', '#FDB022'],
    ['#6938EF', '#1570EF'],
    ['#15B79E', '#027A48'],
    ['#C11574', '#F04438'],
  ];

  // Leva para `when` o que a ação gravou (histórico, comentários, notificações)
  const timed = async (when: Date, action: () => Promise<void>) => {
    const started = new Date(Date.now() - 2000);
    await action();
    await dataSource.query(`UPDATE marketing_history_events SET created_at = $1 WHERE organization_id = $2 AND created_at >= $3`, [when, orgId, started]);
    await dataSource.query(
      `UPDATE marketing_card_comments SET created_at = $1, updated_at = $1 WHERE created_at >= $2 AND card_id IN (SELECT id FROM marketing_cards WHERE organization_id = $3)`,
      [when, started, orgId],
    );
  };

  const ordered = [...CARDS].sort((a, b) => b.createdDaysAgo - a.createdDaysAgo);
  let counter = 0;
  for (const seed of ordered) {
    counter++;
    const createdAt = new Date(now - seed.createdDaysAgo * DAY - counter * 7 * 60_000);
    const step = (n: number) => new Date(Math.min(createdAt.getTime() + n * 3 * 3_600_000, now - 60_000));
    const author = userIds[seed.members?.[0] ?? 'marina'] ?? admin.id;
    const startList = seed.path?.[0] ?? seed.list;
    let cardId = '';

    await timed(createdAt, async () => {
      const card = await cards.create({ listId: listIds[startList], title: seed.title, description: seed.description ?? null }, author, orgId);
      cardId = card.id;
    });
    await dataSource.query(`UPDATE marketing_cards SET created_at = $2, updated_at = $2 WHERE id = $1`, [cardId, createdAt]);

    let n = 1;
    await timed(step(n++), async () => {
      await cards.update(
        cardId,
        {
          dueDate: day(seed.due),
          publishDate: day(seed.publish),
          memberIds: (seed.members ?? []).map((key) => userIds[key]),
          labelIds: (seed.labels ?? []).map((key) => labelIds[key]),
        },
        author,
        orgId,
      );
    });

    for (const [title, done, assignee] of seed.tasks ?? []) {
      await timed(step(n++), async () => {
        const task = await tasks.create(cardId, { title, assigneeId: assignee ? userIds[assignee] : null }, author, orgId);
        if (done) await tasks.update(cardId, task.id, { isDone: true }, author, orgId);
      });
    }

    for (const [kind, i] of (seed.files ?? []).map((kind, i) => [kind, i] as const)) {
      await timed(step(n++), async () => {
        const [from, to] = palette[(counter + i) % palette.length];
        const file =
          kind === 'png'
            ? asUpload(`arte-${counter}-${i + 1}.png`, gradientPng(from, to), 'image/png')
            : asUpload(`briefing-${counter}.pdf`, minimalPdf(seed.title.slice(0, 60)), 'application/pdf');
        const [saved] = await attachments.addFiles(cardId, [file], author, orgId);
        if (kind === 'png' && i === 0 && saved?.id) await cards.setCover(cardId, saved.id, author, orgId);
      });
    }

    for (const [who, body, mentioned] of seed.comments ?? []) {
      await timed(step(n++), async () => {
        await comments.create(cardId, { body, mentionUserIds: (mentioned ?? []).map((key) => userIds[key]) }, userIds[who], orgId);
      });
    }

    for (const next of [...(seed.path ?? []).slice(1), ...(seed.path?.length ? [seed.list] : [])]) {
      await timed(step(n++), async () => {
        await cards.move(cardId, { listId: listIds[next], position: 'last' }, author, orgId);
      });
    }

    if (seed.archived) {
      await timed(step(n++), async () => {
        await cards.archive(cardId, admin.id, orgId);
      });
    }
  }

  // Notificações geradas pelas ações do seed (Fase 2) ficam com a data de agora: deixa as mais antigas como lidas
  const [{ exists }] = await dataSource.query(`SELECT to_regclass('public.notifications') IS NOT NULL AS exists`);
  if (exists) {
    await dataSource.query(
      `UPDATE notifications SET read_at = now() WHERE organization_id = $1 AND link LIKE '/marketing%' AND read_at IS NULL
         AND id NOT IN (SELECT id FROM notifications WHERE organization_id = $1 AND link LIKE '/marketing%' ORDER BY created_at DESC LIMIT 8)`,
      [orgId],
    );
  }

  const [counts] = await dataSource.query(
    `SELECT (SELECT count(*)::int FROM marketing_cards WHERE organization_id = $1 AND is_active) AS active,
            (SELECT count(*)::int FROM marketing_cards WHERE organization_id = $1 AND NOT is_active) AS archived,
            (SELECT count(*)::int FROM marketing_labels WHERE organization_id = $1 AND is_active) AS labels,
            (SELECT count(*)::int FROM marketing_history_events WHERE organization_id = $1) AS events`,
    [orgId],
  );
  console.log(`\nSeed do Marketing concluído para "${orgName}".`);
  console.log(`Cards: ${counts.active} ativos e ${counts.archived} arquivados. Etiquetas: ${counts.labels}. Eventos de histórico: ${counts.events}.`);
  console.log(`Equipe Marketing (Editar): ${MARKETING_USERS.map(([, name, email]) => `${name} <${email}>`).join(', ')}.`);
  console.log(`Equipe ${boardTeamName} (só Visualizar): ${VIEWER[0]} <${VIEWER[1]}>. Senha: ${PASSWORD}.\n`);

  await app.close();
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
