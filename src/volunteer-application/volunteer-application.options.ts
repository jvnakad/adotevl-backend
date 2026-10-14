// Opções do questionário do voluntário fixo. Espelham src/constants/volunteerApplicationOptions.ts do front (rótulos ficam lá).

export enum ReferralSource {
  INSTAGRAM = 'INSTAGRAM',
  TIKTOK = 'TIKTOK',
  INDICACAO = 'INDICACAO',
  PALESTRAS = 'PALESTRAS',
  OUTROS = 'OUTROS',
}

export enum InterestArea {
  MARKETING = 'MARKETING',
  SOCIAL_MEDIA_PAWCO = 'SOCIAL_MEDIA_PAWCO',
  EVENTOS = 'EVENTOS',
  PARCERIAS = 'PARCERIAS',
  OUTROS = 'OUTROS',
}

export enum StrayAnimalsFeeling {
  QUERO_MUDAR = 'QUERO_MUDAR',
  QUERO_AJUDAR = 'QUERO_AJUDAR',
  NAO_ME_INTERESSA = 'NAO_ME_INTERESSA',
}

export enum Loyalty {
  SIM = 'SIM',
  NAO_SEI = 'NAO_SEI',
  NAO = 'NAO',
}

export enum PressureHandling {
  CONSIGO = 'CONSIGO',
  NAO_SEI = 'NAO_SEI',
  NAO_CONSIGO = 'NAO_CONSIGO',
}

export enum StressReaction {
  ASSUSTA = 'ASSUSTA',
  PACIFICA = 'PACIFICA',
  NERVOSO = 'NERVOSO',
}

/** Atropelamento às 23h. PREFERE_NAO_VER é exclusiva. */
export enum RoadkillAction {
  PESQUISA_HOSPITAIS = 'PESQUISA_HOSPITAIS',
  VAI_AO_LOCAL = 'VAI_AO_LOCAL',
  ATUALIZA_INSTAGRAM = 'ATUALIZA_INSTAGRAM',
  PREFERE_NAO_VER = 'PREFERE_NAO_VER',
}

/** Conta do veterinário com caixa zerado. PREFERE_NAO_PARTICIPAR é exclusiva. */
export enum DebtAction {
  EVENTOS = 'EVENTOS',
  RIFA = 'RIFA',
  IDEIAS = 'IDEIAS',
  PREFERE_NAO_PARTICIPAR = 'PREFERE_NAO_PARTICIPAR',
}

export enum DayPeriod {
  MANHA = 'MANHA',
  TARDE = 'TARDE',
  NOITE = 'NOITE',
  MADRUGADA = 'MADRUGADA',
}

/** Ferramentas/redes. NENHUM é exclusiva. */
export enum Tool {
  PACOTE_OFFICE = 'PACOTE_OFFICE',
  CANVA = 'CANVA',
  INSTAGRAM = 'INSTAGRAM',
  CAPCUT = 'CAPCUT',
  TIKTOK = 'TIKTOK',
  NENHUM = 'NENHUM',
}

export enum ShelterVisit {
  SIM = 'SIM',
  SEM_TEMPO = 'SEM_TEMPO',
  OUTRA_CIDADE = 'OUTRA_CIDADE',
}
