// Modelo "MODELO - Termo de Adoção Responsável - AdoteVL.docx" como dados.
// Cada cláusula guarda só o texto depois do título "CLÁUSULA X:" (o número é gerado em contract-numbering.ts).
// Formato do texto: uma linha por parágrafo/item ("(a) ..."), "\n\n" entre blocos.
// Referências a outras cláusulas viram tokens {{clausula:<key>}} para acompanhar a renumeração.

export interface ContractTemplateClause {
  key: string;
  title: string;
  content: string;
  // Cláusula que não pode ser removida (identificação do animal)
  locked?: boolean;
}

export const CONTRACT_TITLE = 'INSTRUMENTO PARTICULAR DE ADOÇÃO E GUARDA RESPONSÁVEL DE ANIMAIS DOMÉSTICOS RESGATADOS';
export const CONTRACT_SUBTITLE = 'ADOTE UM VIRA-LATA';

// Dados fixos da entidade doadora (bloco "DADOS DA ENTIDADE" do modelo)
export const CONTRACT_ORGANIZATION = {
  name: 'Associação Adote um Vira-Lata',
  cnpj: '55.017.717/0001-38',
  email: 'adoteumviralatapr@gmail.com',
  address: 'Rua Expedicionário Eliseu José Hipólito, nº 304 - Bairro Alto Boqueirão- CEP 81.850-320',
  cityState: 'Curitiba-PR',
  phone: '(41) 99542-2456',
  legalRepresentative: 'Júlia Dezordi Ruas',
  signatureName: 'ASSOCIAÇÃO ADOTE UM VIRA-LATA',
};

export const CONTRACT_INTRO =
  'Têm entre si, de maneira justa e acordada, o presente instrumento particular de adoção e guarda responsável de animal doméstico resgatado pela ASSOCIAÇÃO ADOTE UM VIRA-LATA, ficando desde já aceito nos termos e condições a seguir.';

export const DEFAULT_SIGNATURE_CITY = 'Curitiba/PR';

export const CONTRACT_TEMPLATE: ContractTemplateClause[] = [
  {
    key: 'animal',
    title: 'Identificação do animal',
    locked: true,
    content:
      'O presente contrato estabelece direitos e obrigações referentes à doação, entendida como adoção responsável pela parte ADOTANTE, do seguinte animal de estimação:',
  },
  {
    key: 'entrega',
    title: 'Entrega do animal',
    content: 'A DOADORA compromete-se a entregar o animal à parte ADOTANTE na data estipulada em comum acordo entre as partes.',
  },
  {
    key: 'vacina_castracao',
    title: 'Vacina e castração',
    content:
      'Caso o animal seja da espécie canina, a DOADORA será responsável pelo custo da primeira dose da vacina em Clínica Veterinária parceira, e caso o animal seja da espécie felina, a DOADORA será responsável pelo custo da castração em Clínica Veterinária parceira. A ADOTANTE se compromete a levá-lo na data agendada. É facultado à ADOTANTE assumir os referidos custos eximindo, assim, a DOADORA dessa obrigação.',
  },
  {
    key: 'obrigacoes_doadora',
    title: 'Obrigações da doadora',
    content: [
      'São obrigações da DOADORA:',
      '(a) Entregar o animal de estimação descrito na {{clausula:animal}} à parte ADOTANTE somente APÓS a assinatura deste contrato;',
      '(b) Entregar à parte ADOTANTE o cartão de vacinação do animal de estimação, se este existir;',
      '(c) Fornecer à parte ADOTANTE todas as informações de que dispuser sobre o histórico de saúde do animal de estimação, sem omitir qualquer tipo de informação necessária à adaptação e ao bem-estar do animal após a adoção.',
    ].join('\n'),
  },
  {
    key: 'guarda',
    title: 'Guarda e responsabilidade',
    content:
      'Ao receber o animal acima descrito, a parte ADOTANTE declara-se apta para assumir a guarda e a responsabilidade sobre este animal, eximindo a parte DOADORA de toda e qualquer responsabilidade pelos atos praticados pelo animal a partir desta data, resguardado o direito de fiscalização das condições da guarda pela parte DOADORA.',
  },
  {
    key: 'obrigacoes_adotante',
    title: 'Obrigações do adotante',
    content: [
      [
        'A parte ADOTANTE declara estar ciente de todos os cuidados que este animal exige no que se refere à sua guarda e manutenção, além de conhecer todos os riscos inerentes à espécie no convívio com humanos, estando apto a guardá-lo e vigiá-lo, comprometendo-se a:',
        '(a) Garantir o bem-estar do animal, respeitando suas características e zelando pelas suas necessidades psicológicas e físicas;',
        '(b) Garantir sua saúde física fornecendo abrigo, alimento adequado, higiene, vacinas e levando-o regularmente ao veterinário;',
        '(c) Garantir sua saúde psicológica respeitando suas características, com atenção, carinho e a possibilidade de interagir com outras pessoas ou animais;',
        '(d) Garantir sua segurança, mantendo-o sempre dentro de casa e fazendo passeios com coleira e guia;',
        '(e) Proporcionar espaço físico que possibilite ao animal se exercitar, não o deixando confinado a lugar fechado ou amarrado;',
        '(f) Mantê-lo em ambiente limpo, arejado e espaçoso, com possibilidade de abrigo do sol ou chuva;',
        '(g) Identificá-lo com plaquinha ou microchip, facilitando sua recuperação em caso de perda;',
        '(h) Garantir sua esterilização, caso o animal não seja castrado, processo sem contraindicações que garante a redução de animais abandonados nas ruas;',
        '(i) Em nenhuma circunstância abandoná-lo na rua ou entregá-lo a um desconhecido;',
        '(j) Comunicar qualquer outro destino que envolva o animal, tais como desaparecimento ou morte;',
        '(k) Permitir a visita do protetor responsável pela adoção ou antigo dono até a completa adaptação do animal.',
      ].join('\n'),
      'Parágrafo primeiro. A parte ADOTANTE compromete-se ao cumprimento de toda a legislação vigente sobre a guarda de animais e se declara ciente das penalidades previstas para o caso de maus-tratos:',
      [
        'Lei nº 9.605/1998 – capítulo V – seção 1.',
        'Art. 32: PRATICAR ATOS DE ABUSOS, MAUS TRATOS, FERIR OU MUTILAR ANIMAIS DOMÉSTICOS OU DOMESTICADOS, SILVESTRES, NATIVOS OU EXÓTICOS.',
        'PENA: detenção de 3 (três) meses a um ano e multa variando de 1 (um) a 360 (trezentos e sessenta) salários-mínimos, podendo dobrar a pena com a morte do animal.',
      ].join('\n'),
      'Parágrafo segundo: A parte ADOTANTE se compromete a adotar todas as medidas necessárias a impedir os maus-tratos ao animal, em especial o tratamento veterinário (doenças, sarna, carrapato, desnutrição), jamais permitindo que seja agredido, ferido ou torturado, tampouco amarrado com cordas ou correntes ou confinado em lugar não condizente com o seu tamanho, que o impossibilite de movimentar-se e exercitar-se.',
      'Parágrafo terceiro. A parte ADOTANTE declara que foi informada da dificuldade de se prever o porte exato do animal por tratar-se de animal órfão e que o animal pode vir a crescer além do esperado, assumindo a responsabilidade por tal fato.',
      'Parágrafo quarto. A parte ADOTANTE declara estar ciente de que todos os animais têm características inerentes a sua espécie, eles latem/miam e têm necessidade de urinar e defecar (muitas vezes em locais inapropriados). Se o animal viver em apartamento ou casa sem quintal, a parte ADOTANTE assume a obrigação de levá-lo à rua para fazer suas necessidades, e, no caso de gatos, manter a caixa de areia sempre limpa.',
      'Parágrafo quinto. A parte ADOTANTE declara estar ciente de que um cão ou gato pode viver até 15 (quinze) anos ou mais, e durante todo este tempo será responsável pelo seu bem-estar, principalmente durante sua velhice.',
      'Parágrafo sexto. A parte ADOTANTE garante que não há riscos de fuga no local de abrigo do animal, equipado com telas, muros altos e/ou grades e portões bem fechados.',
    ].join('\n\n'),
  },
  {
    key: 'danos',
    title: 'Danos causados pelo animal',
    content:
      'A partir do momento em que tiver recebido o animal de estimação, a parte ADOTANTE será única e integralmente responsável pelos eventuais danos causados pelo animal de estimação a ele, ADOTANTE, ou a terceiros, não podendo a parte DOADORA ser por eles responsabilizada.',
  },
  {
    key: 'taxa_reembolso',
    title: 'Taxa de reembolso',
    content:
      'A parte ADOTANTE realizou o pagamento da taxa de reembolso, com valor simbólico de R$ 150,00 (cento e cinquenta reais) via PIX para a conta bancária da parte DOADORA, referente às despesas que a parte DOADORA teve com o animal de estimação durante o período de reabilitação.',
  },
  {
    key: 'acompanhamento',
    title: 'Acompanhamento',
    content: [
      'A parte DOADORA poderá acompanhar o crescimento e a adaptação do animal de estimação até o seu completo desenvolvimento e a parte ADOTANTE concorda em enviar fotos e vídeos para a DOADORA e com visitas periódicas para averiguação das condições do animal.',
      'Parágrafo primeiro. A parte ADOTANTE fica ciente do dever fiscalizatório da parte DOADORA como protetora de animais e se compromete a enviar fotos e vídeos do animal, quando solicitado.',
      'Parágrafo segundo: A parte ADOTANTE fica ciente de que a constatação do descumprimento deste contrato ou das obrigações legais de proteção do animal serão objeto de apuração policial e medidas judiciais cabíveis, além das penalidades previstas no presente contrato.',
    ].join('\n\n'),
  },
  {
    key: 'venda_doacao',
    title: 'Proibição de venda ou doação',
    content: [
      'A parte ADOTANTE não poderá vender nem doar o animal de estimação para terceiros.',
      'Parágrafo primeiro: Caso a parte ADOTANTE não possa mais exercer a guarda do animal, por motivo relevante, deverá entrar em contato com a parte DOADORA para verificar a possibilidade de recebê-lo.',
    ].join('\n\n'),
  },
  {
    key: 'desistencia',
    title: 'Desistência',
    content: [
      'A parte ADOTANTE poderá desistir da adoção do animal de estimação, devolvendo-o à parte DOADORA, desde que conceda o prazo de 10 dias para que esta realoque o animal em seu abrigo.',
      'Parágrafo primeiro. A devolução, contudo, não isenta a parte ADOTANTE do pagamento no importe de R$ 1.000,00 (mil reais) previsto na {{clausula:multa}}.',
    ].join('\n\n'),
  },
  {
    key: 'multa',
    title: 'Multa',
    content:
      'Constatada a infração pela parte ADOTANTE de quaisquer das cláusulas dispostas no presente contrato, ou no caso de devolução do Animal, a parte ADOTANTE perderá a guarda do animal, devendo restituí-lo à parte DOADORA, à qual deverá pagar multa no valor de R$ 1.000,00 (mil reais), sendo este valor aumentado em 10 (dez) vezes caso sejam constatados maus-tratos, sem prejuízo das penalidades legais.',
  },
  {
    key: 'rescisao',
    title: 'Rescisão',
    content: [
      'O presente contrato será rescindido pelo descumprimento das obrigações nele previstas, por qualquer das partes, mesmo após a entrega do animal de estimação.',
      'Parágrafo primeiro. O descumprimento deste contrato pela parte ADOTANTE é causa de rescisão e de aplicação das penalidades previstas neste contrato, sem prejuízo de eventuais reparações.',
    ].join('\n\n'),
  },
  {
    key: 'foro',
    title: 'Foro',
    content: 'As partes elegem o Foro de Curitiba, Estado do Paraná, para dirimir quaisquer controvérsias referentes ao presente instrumento.',
  },
];

export const CONTRACT_TEMPLATE_BY_KEY: Record<string, ContractTemplateClause> = Object.fromEntries(
  CONTRACT_TEMPLATE.map((clause) => [clause.key, clause]),
);
