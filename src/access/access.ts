// Telas do sistema com permissão por equipe. Valores gravados em team_permissions.screen.
export enum Screen {
  PETS = 'PETS',
  MEDICAL_RECORDS = 'MEDICAL_RECORDS',
  SCHEDULE = 'SCHEDULE',
  ADOPTERS = 'ADOPTERS',
  ADOPTION_CONTRACT = 'ADOPTION_CONTRACT',
  ADOPTION_HISTORY = 'ADOPTION_HISTORY',
  CAMPAIGNS = 'CAMPAIGNS',
  PARTNERS = 'PARTNERS',
  VOLUNTEERS = 'VOLUNTEERS',
  TEAMS = 'TEAMS',
  FINANCIAL = 'FINANCIAL',
  BANK_ACCOUNTS = 'BANK_ACCOUNTS',
  STOCK = 'STOCK',
  STOCK_PRODUCT_TYPES = 'STOCK_PRODUCT_TYPES',
  STOCK_HISTORY = 'STOCK_HISTORY',
}

export enum AccessLevel {
  NONE = 'NONE',
  VIEW = 'VIEW',
  EDIT = 'EDIT',
}

export interface ScreenDefinition {
  key: Screen;
  label: string;
  /** Sub-tela: exige ao menos Visualizar na tela mãe */
  parent?: Screen;
  /** Tela só de leitura: não aceita Editar */
  viewOnly?: boolean;
}

// Ordem de exibição na matriz de permissões do front
export const SCREENS: ScreenDefinition[] = [
  { key: Screen.PETS, label: 'Pets' },
  { key: Screen.MEDICAL_RECORDS, label: 'Prontuário', parent: Screen.PETS },
  // Visualizar: ver e marcar/desmarcar o próprio horário. Editar: trancar dias e marcar/remover por qualquer voluntário
  { key: Screen.SCHEDULE, label: 'Agenda' },
  { key: Screen.ADOPTERS, label: 'Adotantes' },
  { key: Screen.ADOPTION_CONTRACT, label: 'Termo de adoção', parent: Screen.ADOPTERS },
  { key: Screen.ADOPTION_HISTORY, label: 'Histórico de adoção', parent: Screen.ADOPTERS, viewOnly: true },
  { key: Screen.CAMPAIGNS, label: 'Campanhas' },
  { key: Screen.PARTNERS, label: 'Parceiros' },
  { key: Screen.VOLUNTEERS, label: 'Voluntários' },
  { key: Screen.TEAMS, label: 'Equipes' },
  { key: Screen.FINANCIAL, label: 'Financeiro' },
  { key: Screen.BANK_ACCOUNTS, label: 'Contas bancárias', parent: Screen.FINANCIAL },
  { key: Screen.STOCK, label: 'Estoque' },
  { key: Screen.STOCK_PRODUCT_TYPES, label: 'Tipos de produto', parent: Screen.STOCK },
  { key: Screen.STOCK_HISTORY, label: 'Histórico do estoque', parent: Screen.STOCK, viewOnly: true },
];

export const SCREEN_BY_KEY = Object.fromEntries(SCREENS.map((screen) => [screen.key, screen])) as Record<Screen, ScreenDefinition>;

const LEVEL_RANK: Record<AccessLevel, number> = { NONE: 0, VIEW: 1, EDIT: 2 };

export const hasLevel = (granted: AccessLevel | undefined, required: AccessLevel) => LEVEL_RANK[granted ?? AccessLevel.NONE] >= LEVEL_RANK[required];

export type ScreenPermissions = Partial<Record<Screen, AccessLevel>>;

/** Acesso efetivo do usuário logado (equipe + permissões). */
export interface UserAccess {
  teamId: string;
  teamName: string;
  isAdmin: boolean;
  permissions: ScreenPermissions;
}

/** Equipe Admin: Editar em todas as telas, inclusive as que forem criadas depois. */
export const ADMIN_PERMISSIONS: ScreenPermissions = Object.fromEntries(
  SCREENS.map((screen) => [screen.key, screen.viewOnly ? AccessLevel.VIEW : AccessLevel.EDIT]),
);
