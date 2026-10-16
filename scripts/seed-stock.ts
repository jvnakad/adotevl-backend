// Seed de estoque para TESTE LOCAL: tipos, produtos e histórico de uma ONG de pets, com datas espalhadas nos últimos 90 dias.
// Uso: npm run seed:stock [-- --org=<id ou CNPJ>] [-- --reset]
//   --org=<id|cnpj>  organização alvo (padrão: a primeira organização existente)
//   --reset          apaga SÓ os dados de estoque (eventos, produtos e tipos) da organização alvo e recria
// Idempotente: se a organização já tem dados de estoque, não faz nada (use --reset para recriar).
// Só roda com o banco em localhost/127.0.0.1 (ou, na stack Docker local, no serviço do compose com ALLOW_LOCAL_SEED=1) e fora de produção.
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { ProductTypeService } from '../src/stock/product-type.service';
import { ProductService } from '../src/stock/product.service';
import { ProductUnit } from '../src/stock/product.entity';
import { addDays, todayInBrazil } from '../src/volunteer-schedule/schedule-time';

const DAY = 86_400_000;

function assertLocal() {
  if (process.env.NODE_ENV === 'production') throw new Error('seed:stock não roda com NODE_ENV=production.');
  let host = '';
  try {
    host = new URL(process.env.DATABASE_URL ?? '').hostname;
  } catch {
    // DATABASE_URL ausente ou inválida cai na recusa abaixo
  }
  const isLoopback = host === 'localhost' || host === '127.0.0.1';
  // Stack local em Docker: o banco é o serviço do compose (ex.: "db"). Só vale com ALLOW_LOCAL_SEED=1 (definido apenas no compose local)
  // e com host de um rótulo só, sem ponto: um banco remoto (db.exemplo.com, *.supabase.co) continua recusado.
  const isComposeService = process.env.ALLOW_LOCAL_SEED === '1' && /^[a-z][a-z0-9_-]*$/i.test(host);
  if (!isLoopback && !isComposeService) {
    throw new Error(
      `seed:stock só roda com DATABASE_URL apontando para localhost ou 127.0.0.1 (host atual: "${host || 'indefinido'}"). ` +
        'Na stack Docker local, ALLOW_LOCAL_SEED=1 libera o nome do serviço do banco (ex.: db).',
    );
  }
}

const argValue = (name: string) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

type Unit = keyof typeof ProductUnit;
// [chave, nome, chave do tipo, unidade, quantidade, vencimento (dias a partir de hoje) ou null, observações ou null, cadastrado há N dias, autor (1 ou 2)]
type ProductRow = [string, string, string, Unit, string, number | null, string | null, number, 1 | 2];

const LONG_NOTES =
  'Lote doado pela clínica parceira após a campanha de adoção do mês passado. Armazenar em local seco e arejado, longe da luz solar direta. ' +
  'Conferir a validade a cada 15 dias e separar as caixas com embalagem danificada. Uso restrito a animais acima de 8 semanas e 2 kg; ' +
  'filhotes menores só com orientação do veterinário voluntário. Registrar na planilha da bancada cada caixa retirada, com o nome do animal e a data. ' +
  'Em caso de reação (coceira, vômito, apatia), suspender e avisar a coordenação imediatamente. Última contagem física feita junto com a equipe de sábado.';

const LONG_NAME =
  'Antipulgas e carrapatos para cães de médio e grande porte (comprimido mastigável, caixa com 3 unidades, lote doado pela clínica parceira)';

// Tipos: [chave, nome inicial, criado há N dias]
const TYPES: [string, string, number][] = [
  ['racao', 'Racao', 90],
  ['medicamento', 'Medicamento', 89],
  ['limpeza', 'Produto de limpeza', 89],
  ['higiene', 'Higiene pet', 88],
  ['roupas', 'Roupas', 88],
  ['coleiras', 'Coleiras e guias', 87],
  ['brinquedos', 'Brinquedo', 87],
  ['areia', 'Areia', 86],
  ['vacinas', 'Vacinas', 85],
];

const PRODUCTS: ProductRow[] = [
  ['p1', 'Ração Golden', 'racao', 'KG', '45.000', 200, null, 80, 1],
  ['p2', 'Ração Premier Filhotes', 'racao', 'KG', '18.500', 120, null, 75, 1],
  ['p3', 'Ração Pedigree Adultos', 'racao', 'KG', '120.000', 90, 'Sacos de 10,1 kg', 70, 2],
  ['p4', 'Ração Whiskas Gatos Adultos', 'racao', 'KG', '62.500', -12, null, 65, 1],
  ['p5', 'Ração úmida sachê (cães)', 'racao', 'UNIT', '1250', 45, null, 60, 1],
  ['p6', 'Ração Special Dog Carne', 'racao', 'KG', '1250.500', 300, 'Estoque do galpão', 58, 2],
  ['p7', 'Petisco de frango desidratado', 'racao', 'UNIT', '24', -3, null, 50, 1],
  ['p8', 'Vermífugo Drontal', 'medicamento', 'UNIT', '20', 150, null, 79, 1],
  ['p9', 'Antipulgas Bravecto 10 a 20 kg', 'medicamento', 'UNIT', '6', 240, 'Guardar na geladeira da clínica', 72, 1],
  ['p10', 'Antibiótico Doxiciclina 100 mg', 'medicamento', 'UNIT', '12', 60, null, 66, 1],
  ['p11', 'Soro fisiológico 500 ml', 'medicamento', 'UNIT', '30', -40, 'Descartar na próxima limpeza', 62, 2],
  ['p12', 'Vitamina em gotas (filhotes)', 'medicamento', 'LITER', '2.500', 180, null, 45, 1],
  ['p13', 'Anti-inflamatório Meloxicam', 'medicamento', 'UNIT', '14', 75, null, 40, 1],
  ['p14', 'Vacina V10 (lote antigo)', 'vacinas', 'UNIT', '8', -20, 'Tipo "Vacinas" foi excluído; produto continua listado', 78, 1],
  ['p15', 'Água sanitária', 'limpeza', 'LITER', '40.000', null, null, 74, 1],
  ['p16', 'Desinfetante Pinho Sol', 'limpeza', 'LITER', '22.500', null, null, 73, 2],
  ['p17', 'Detergente neutro', 'limpeza', 'LITER', '18.000', 400, null, 60, 1],
  ['p18', 'Sabão em pó', 'limpeza', 'KG', '12.500', null, null, 55, 1],
  ['p19', 'Saco de lixo 100 L', 'limpeza', 'UNIT', '300', null, null, 30, 1],
  ['p20', 'Álcool 70%', 'limpeza', 'LITER', '15.250', 500, null, 20, 2],
  ['p21', 'Shampoo Pet®', 'higiene', 'UNIT', '16', 365, 'Neutro, para filhotes e adultos', 71, 1],
  ['p22', 'Condicionador neutro', 'higiene', 'UNIT', '9', null, null, 64, 1],
  ['p23', 'Tapete higiênico', 'higiene', 'UNIT', '220', null, null, 52, 2],
  ['p24', 'Escova de dentes para cães', 'limpeza', 'UNIT', '12', null, null, 35, 1],
  ['p25', 'Lenço umedecido pet', 'higiene', 'UNIT', '40', -5, null, 28, 1],
  ['p26', 'Cobertor de fleece', 'roupas', 'UNIT', '25', null, null, 68, 1],
  ['p27', 'Roupinha de inverno (tamanho M)', 'roupas', 'UNIT', '11', null, 'Doação da feira de adoção', 47, 2],
  ['p28', 'Caminha lavável', 'roupas', 'UNIT', '6', null, null, 22, 1],
  ['p29', 'Coleira M azul', 'coleiras', 'UNIT', '18', null, null, 66, 1],
  ['p30', 'Guia retrátil 5 m', 'coleiras', 'UNIT', '7', null, null, 44, 1],
  ['p31', 'Peitoral G', 'coleiras', 'UNIT', '5', null, null, 26, 2],
  ['p32', 'Bolinha de borracha', 'brinquedos', 'UNIT', '35', null, null, 59, 1],
  ['p33', 'Mordedor de corda', 'brinquedos', 'UNIT', '20', null, null, 37, 1],
  ['p34', 'Arranhador para gatos', 'brinquedos', 'UNIT', '4', null, null, 15, 1],
  ['p35', 'Areia', 'areia', 'KG', '180.000', null, null, 70, 1],
  ['p36', 'Areia de sílica', 'areia', 'KG', '75.250', 700, null, 33, 1],
  ['p37', LONG_NAME, 'medicamento', 'UNIT', '3', 30, LONG_NOTES, 10, 1],
  ['p38', 'Leite em pó para filhotes', 'racao', 'UNIT', '12', 60, null, 42, 1],
  ['p39', 'Ração Light (amostra)', 'racao', 'KG', '0', null, null, 18, 1],
  ['p40', 'Cobertor velho', 'roupas', 'UNIT', '2', null, 'Rasgado, para descarte', 50, 2],
  ['p41', 'Toalha de banho', 'higiene', 'UNIT', '14', null, null, 12, 1],
  ['p42', 'Pote de ração inox', 'coleiras', 'UNIT', '27', null, null, 8, 1],
  ['p43', 'Termômetro digital', 'medicamento', 'UNIT', '2', null, null, 5, 1],
  ['p44', 'Seringa 5 ml', 'medicamento', 'UNIT', '150', 365, null, 3, 2],
  ['p45', 'Luvas descartáveis', 'limpeza', 'UNIT', '400', null, null, 1, 1],
];

async function main() {
  // Antes de subir a aplicação (o synchronize mexeria no banco): importar o AppModule já carregou o .env.local em process.env
  assertLocal();
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });

  const dataSource = app.get(DataSource);
  const types = app.get(ProductTypeService, { strict: false });
  const products = app.get(ProductService, { strict: false });

  // ---- organização e autores
  const orgArg = argValue('org');
  const orgs: { id: string; legal_name: string }[] = orgArg
    ? await dataSource.query('SELECT id, legal_name FROM organizations WHERE id::text = $1 OR cnpj = $1', [orgArg])
    : await dataSource.query('SELECT id, legal_name FROM organizations ORDER BY created_at ASC LIMIT 1');
  if (!orgs.length) throw new Error(orgArg ? `Organização "${orgArg}" não encontrada.` : 'Nenhuma organização encontrada. Rode npm run seed:dev antes.');
  const orgId = orgs[0].id;

  const users: { id: string; full_name: string }[] = await dataSource.query(
    'SELECT id, full_name FROM users WHERE organization_id = $1 AND "isActive" = true ORDER BY created_at ASC',
    [orgId],
  );
  if (!users.length) throw new Error(`A organização "${orgs[0].legal_name}" não tem usuário ativo para ser o autor.`);
  const author1 = users[0];
  const author2 = users[1] ?? users[0];

  // ---- idempotência e reset
  const existing = await dataSource.query(
    `SELECT (SELECT count(*)::int FROM product_types WHERE organization_id = $1) AS types,
            (SELECT count(*)::int FROM products WHERE organization_id = $1) AS products,
            (SELECT count(*)::int FROM stock_history_events WHERE organization_id = $1) AS events`,
    [orgId],
  );
  const had = existing[0];
  if (process.argv.includes('--reset')) {
    console.warn(`ATENÇÃO: --reset apaga os dados de estoque da organização "${orgs[0].legal_name}" (${had.types} tipos, ${had.products} produtos, ${had.events} eventos).`);
    await dataSource.query('DELETE FROM stock_history_events WHERE organization_id = $1', [orgId]);
    await dataSource.query('DELETE FROM products WHERE organization_id = $1', [orgId]);
    await dataSource.query('DELETE FROM product_types WHERE organization_id = $1', [orgId]);
  } else if (had.types + had.products + had.events > 0) {
    console.log(`A organização "${orgs[0].legal_name}" já tem dados de estoque (${had.types} tipos, ${had.products} produtos, ${had.events} eventos). Nada foi feito; use --reset para recriar.`);
    await app.close();
    return;
  }

  // ---- linha do tempo: cada ação roda em ordem cronológica e as datas são ajustadas depois (retroativas)
  const now = Date.now();
  const at = (daysAgo: number, order: number) => new Date(now - daysAgo * DAY - order * 41 * 60_000);
  const authorOf = (n: 1 | 2) => (n === 2 ? author2 : author1);
  const typeIds: Record<string, string> = {};
  const productIds: Record<string, string> = {};
  const today = todayInBrazil();
  const expiration = (days: number | null) => (days === null ? null : addDays(today, days));

  const actions: { when: Date; run: () => Promise<void> }[] = [];
  let order = 0;
  const schedule = (daysAgo: number, run: (when: Date) => Promise<void>) => {
    const when = at(daysAgo, order++);
    actions.push({ when, run: () => run(when) });
  };

  const redate = async (table: 'product_types' | 'products', id: string, when: Date, created = false) => {
    await dataSource.query(`UPDATE ${table} SET ${created ? 'created_at = $2, ' : ''}updated_at = $2 WHERE id = $1`, [id, when]);
  };
  // Executa a ação e leva para `when` os eventos que ela gravou
  const timed = async (when: Date, action: () => Promise<void>) => {
    const started = new Date(Date.now() - 2000);
    await action();
    await dataSource.query('UPDATE stock_history_events SET created_at = $1 WHERE organization_id = $2 AND created_at >= $3', [when, orgId, started]);
  };

  // Tipos
  for (const [key, name, daysAgo] of TYPES) {
    schedule(daysAgo, (when) =>
      timed(when, async () => {
        const created = await types.create({ name }, author1.id, orgId);
        typeIds[key] = created.id;
        await redate('product_types', created.id, when, true);
      }),
    );
  }
  const renameType = (key: string, name: string, daysAgo: number, by: 1 | 2 = 1) =>
    schedule(daysAgo, (when) =>
      timed(when, async () => {
        await types.update(typeIds[key], { name }, authorOf(by).id, orgId);
        await redate('product_types', typeIds[key], when);
      }),
    );
  renameType('racao', 'Ração', 85); // só acento
  renameType('higiene', 'Produto de higiene pet', 84);
  renameType('brinquedos', 'Brinquedos', 50, 2);
  schedule(35, (when) =>
    timed(when, async () => {
      await types.remove(typeIds.vacinas, author1.id, orgId); // continua com o produto V10 vinculado
      await redate('product_types', typeIds.vacinas, when);
    }),
  );

  // Produtos
  for (const [key, name, typeKey, unit, quantity, expDays, notes, daysAgo, by] of PRODUCTS) {
    schedule(daysAgo, (when) =>
      timed(when, async () => {
        const created = await products.create(
          { name, productTypeId: typeIds[typeKey], unit: ProductUnit[unit], quantity, expirationDate: expiration(expDays), notes },
          authorOf(by).id,
          orgId,
        );
        productIds[key] = created.id;
        await redate('products', created.id, when, true);
      }),
    );
  }

  type Patch = Parameters<ProductService['update']>[1];
  const editProduct = (key: string, patch: Patch, daysAgo: number, by: 1 | 2 = 1) =>
    schedule(daysAgo, (when) =>
      timed(when, async () => {
        await products.update(productIds[key], patch, authorOf(by).id, orgId);
        await redate('products', productIds[key], when);
      }),
    );
  const removeProduct = (key: string, daysAgo: number, by: 1 | 2 = 1) =>
    schedule(daysAgo, (when) =>
      timed(when, async () => {
        await products.remove(productIds[key], authorOf(by).id, orgId);
        await redate('products', productIds[key], when);
      }),
    );

  editProduct('p1', { name: 'Ração Golden Special 15 kg' }, 55); // renomeado: buscar "Golden" ou o nome novo
  editProduct('p1', { quantity: '38.500' }, 30, 2);
  editProduct('p3', { quantity: '95' }, 40, 2);
  editProduct('p2', { quantity: '10.000' }, 20, 2);
  editProduct('p4', { notes: 'Doação da empresa parceira. Conferir a embalagem antes de usar.' }, 25);
  editProduct('p10', { quantity: '0' }, 34, 2); // acabou
  editProduct('p21', { quantity: '11' }, 14, 2);
  editProduct('p35', { name: 'Areia higiênica' }, 50); // renomeado
  editProduct('p35', { quantity: '150.000' }, 21);
  editProduct('p38', { unit: ProductUnit.KG, quantity: '2.5' }, 25, 2); // troca de unidade: dois itens no de/para
  editProduct('p9', { quantity: '4' }, 10, 2);
  editProduct('p15', { notes: 'Comprar mais no fim do mês' }, 30);
  removeProduct('p39', 9);
  removeProduct('p40', 30, 2);
  removeProduct('p41', 5);

  // Troca de tipo: p24 foi cadastrado em "Produto de limpeza" e passa para "Produto de higiene pet"
  schedule(30, (when) =>
    timed(when, async () => {
      await products.update(productIds.p24, { productTypeId: typeIds.higiene }, author1.id, orgId);
      await redate('products', productIds.p24, when);
    }),
  );

  actions.sort((a, b) => a.when.getTime() - b.when.getTime());
  for (const action of actions) await action.run();

  const counts = (
    await dataSource.query(
      `SELECT (SELECT count(*)::int FROM product_types WHERE organization_id = $1 AND is_active) AS types_active,
              (SELECT count(*)::int FROM product_types WHERE organization_id = $1 AND NOT is_active) AS types_deleted,
              (SELECT count(*)::int FROM products WHERE organization_id = $1 AND is_active) AS products_active,
              (SELECT count(*)::int FROM products WHERE organization_id = $1 AND NOT is_active) AS products_deleted,
              (SELECT count(*)::int FROM stock_history_events WHERE organization_id = $1) AS events`,
      [orgId],
    )
  )[0];
  console.log(`\nSeed de estoque concluído para "${orgs[0].legal_name}".`);
  console.log(`Tipos: ${counts.types_active} ativos e ${counts.types_deleted} excluído(s). Produtos: ${counts.products_active} ativos e ${counts.products_deleted} excluídos. Eventos de histórico: ${counts.events}.`);
  console.log(`Autores: ${author1.full_name}${author2.id !== author1.id ? ` e ${author2.full_name}` : ' (a organização só tem um usuário ativo)'}.\n`);

  await app.close();
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
