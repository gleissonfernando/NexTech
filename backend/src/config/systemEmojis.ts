export type SystemEmojiKey =
  | "visto"
  | "trofeu_alt"
  | "trofeu"
  | "robo"
  | "relogio"
  | "prancheta"
  | "prancheta_caneta"
  | "porta"
  | "perigo"
  | "link"
  | "liga"
  | "interrogacao"
  | "engrenagem"
  | "homem"
  | "folha"
  | "exclamacao"
  | "discord"
  | "dinheiro"
  | "prancheta_acertos"
  | "calendario"
  | "caixa"
  | "aniversario"
  | "alerta"
  | "acessar"
  | "nuvem"
  | "arma"
  | "banco"
  | "bandeira"
  | "mais"
  | "salvar"
  | "voltar"
  | "CHATBlack"
  | "CHATBlack_Crown"
  | "CHATBlack_hearts"
  | "CHATBlack_knife"
  | "CHATBlack_gun"
  | "CHATBlack_skull"
  | "CHATBlack_error"
  | "CHATBlack_insta"
  | "CHATDiscord_Black"
  | "CHATBlack_Broken_Heart"
  | "CHATBlack_1knife"
  | "CHATBlack_heart1"
  | "CHATblack_gun_ak47black"
  | "CHATLc_louis_vuitton_black"
  | "fantasma"
  | "CHATamor"
  | "CHATmessage_love"
  | "CHATBlack_Question_Mark"
  | "CHATblack_check"
  | "CHATblack_anguelaconfuso"
  | "CHATarma"
  | "CHATdancando_com_arma"
  | "CHATDinheiro"
  | "CHATDinheiro1"
  | "CHATdinheiro2"
  | "VORTEXtesteDiscord_Black"
  | "VORTEXtesteBlack"
  | "VORTEXtesteBlack_Question"
  | "VORTEXtesteblack_check"
  | "VORTEXtesteDinheiro"
  | "VORTEXtesteDinheiro1"
  | "VORTEX1505360210200049"
  | "VORTEXporta"
  | "VORTEXanotaao"
  | "VORTEXavisos"
  | "VORTEX1502459290164789"
  | "VORTEXPASTA"
  | "VORTEXLINK"
  | "VORTEXtrabalho"
  | "VORTEX1187919283641135114"
  | "VORTEX1187919258877960"
  | "VORTEX1187919201764118649"
  | "VORTEX1187919184420679"
  | "VORTEX1479930855534106"
  | "782145discordoriginalykno"
  | "420434discordstaffbadge"
  | "701767discordsupportcom";

export type SystemEmojiDefinition = {
  key: SystemEmojiKey;
  name: string;
  aliases?: readonly string[];
  fallback: string;
  label: string;
  description: string;
};

export type FixedSystemEmojiDefinition = {
  name: string;
  emojiId: string;
  animated: boolean;
};

export const FIXED_SYSTEM_EMOJI_BY_KEY: Readonly<Record<SystemEmojiKey, FixedSystemEmojiDefinition>> = {
  visto: { name: "visto", emojiId: "1525682264300716082", animated: true },
  trofeu_alt: { name: "trofeu_alt", emojiId: "1525682260525711431", animated: true },
  trofeu: { name: "trofeu", emojiId: "1525682256654504087", animated: true },
  robo: { name: "robo", emojiId: "1525682252737020015", animated: true },
  relogio: { name: "relogio", emojiId: "1525682248404308131", animated: true },
  prancheta: { name: "prancheta", emojiId: "1525682244893544489", animated: true },
  prancheta_caneta: { name: "prancheta_caneta", emojiId: "1525682240699498496", animated: true },
  porta: { name: "porta", emojiId: "1525682236521713815", animated: true },
  perigo: { name: "perigo", emojiId: "1525682232067358853", animated: true },
  link: { name: "link", emojiId: "1525682228170981478", animated: true },
  liga: { name: "liga", emojiId: "1525682224308027432", animated: true },
  interrogacao: { name: "interrogacao", emojiId: "1525682220126306465", animated: true },
  engrenagem: { name: "engrenagem", emojiId: "1525682215948783858", animated: true },
  homem: { name: "homem", emojiId: "1525682211985035416", animated: true },
  folha: { name: "folha", emojiId: "1525682208122212553", animated: true },
  exclamacao: { name: "exclamacao", emojiId: "1525682200698163322", animated: true },
  discord: { name: "discord", emojiId: "1525682196277493861", animated: true },
  dinheiro: { name: "dinheiro", emojiId: "1525682192640905216", animated: true },
  prancheta_acertos: { name: "prancheta_acertos", emojiId: "1525682188798922853", animated: true },
  calendario: { name: "calendario", emojiId: "1525682184948547724", animated: true },
  caixa: { name: "caixa", emojiId: "1525682180578214021", animated: true },
  aniversario: { name: "aniversario", emojiId: "1525682177017118902", animated: true },
  alerta: { name: "alerta", emojiId: "1525682173246574692", animated: true },
  acessar: { name: "acessar", emojiId: "1525682169454919840", animated: true },
  nuvem: { name: "nuvem", emojiId: "1525682165353025576", animated: true },
  arma: { name: "CHATarma", emojiId: "1519956887301390456", animated: true },
  banco: { name: "dinheiro", emojiId: "1525682192640905216", animated: true },
  bandeira: { name: "trofeu", emojiId: "1525682256654504087", animated: true },
  mais: { name: "acessar", emojiId: "1525682169454919840", animated: true },
  salvar: { name: "prancheta_acertos", emojiId: "1525682188798922853", animated: true },
  voltar: { name: "porta", emojiId: "1525682236521713815", animated: true },
  CHATBlack: { name: "CHATBlack", emojiId: "1519956916468715530", animated: true },
  CHATBlack_Crown: { name: "CHATBlack_Crown", emojiId: "1519956681314926644", animated: true },
  CHATBlack_hearts: { name: "CHATblack_hearts", emojiId: "1519956675635712041", animated: true },
  CHATBlack_knife: { name: "CHATblack_knifee", emojiId: "1519956669906288802", animated: true },
  CHATBlack_gun: { name: "CHATarma", emojiId: "1519956887301390456", animated: true },
  CHATBlack_skull: { name: "fantasma", emojiId: "1525682204548792410", animated: true },
  CHATBlack_error: { name: "CHATblack_error", emojiId: "1519956939973328906", animated: true },
  CHATBlack_insta: { name: "CHATDiscord_Black", emojiId: "1519956922495668245", animated: true },
  CHATDiscord_Black: { name: "CHATDiscord_Black", emojiId: "1519956922495668245", animated: true },
  CHATBlack_Broken_Heart: { name: "CHATblack_heart1", emojiId: "1519956934105632798", animated: true },
  CHATBlack_1knife: { name: "CHATblack_knifee", emojiId: "1519956669906288802", animated: true },
  CHATBlack_heart1: { name: "CHATblack_heart1", emojiId: "1519956934105632798", animated: true },
  CHATblack_gun_ak47black: { name: "CHATie_black_gun_ak47bl", emojiId: "1519956928359432273", animated: true },
  CHATLc_louis_vuitton_black: { name: "CHATLC_louis_vuitton_black", emojiId: "1519956910634176582", animated: true },
  fantasma: { name: "fantasma", emojiId: "1525682204548792410", animated: true },
  CHATamor: { name: "CHATAmor", emojiId: "1519956693197389935", animated: true },
  CHATmessage_love: { name: "CHATmessage_love", emojiId: "1519956687182757990", animated: true },
  CHATBlack_Question_Mark: { name: "CHATBlack_Question_Mark", emojiId: "1519956904963608658", animated: true },
  CHATblack_check: { name: "CHATblack_check", emojiId: "1519956899213082634", animated: true },
  CHATblack_anguelaconfuso: { name: "CHATblack_anguelaconfuso", emojiId: "1519956893324410950", animated: true },
  CHATarma: { name: "CHATarma", emojiId: "1519956887301390456", animated: true },
  CHATdancando_com_arma: { name: "CHATdancando_com_arma", emojiId: "1519956881076916404", animated: true },
  CHATDinheiro: { name: "CHATDinheiro", emojiId: "1519956875150364752", animated: true },
  CHATDinheiro1: { name: "CHATDinheiro1", emojiId: "1519956869290922054", animated: true },
  CHATdinheiro2: { name: "CHATdinheiro2", emojiId: "1519956863507239003", animated: true },
  VORTEXtesteDiscord_Black: { name: "VORTEXtesteDiscord_Black", emojiId: "1519956857584877618", animated: true },
  VORTEXtesteBlack: { name: "VORTEXtesteBlack", emojiId: "1519956851821772800", animated: true },
  VORTEXtesteBlack_Question: { name: "VORTEXtesteBlack_Question", emojiId: "1519956839805092002", animated: true },
  VORTEXtesteblack_check: { name: "VORTEXtesteblack_check", emojiId: "1519956834239254651", animated: true },
  VORTEXtesteDinheiro: { name: "VORTEXtesteDinheiro", emojiId: "1519956810122133644", animated: true },
  VORTEXtesteDinheiro1: { name: "VORTEXtesteDinheiro1", emojiId: "1519956804078014514", animated: true },
  VORTEX1505360210200049: { name: "VORTEX1505360210200049", emojiId: "1519956786159816714", animated: true },
  VORTEXporta: { name: "VORTEXporta", emojiId: "1519956780531060867", animated: true },
  VORTEXanotaao: { name: "VORTEXanotaao", emojiId: "1519956774860623963", animated: true },
  VORTEXavisos: { name: "VORTEXavisos", emojiId: "1519956769030410361", animated: true },
  VORTEX1502459290164789: { name: "VORTEX1502459290164789", emojiId: "1519956763556974663", animated: true },
  VORTEXPASTA: { name: "VORTEXPASTA", emojiId: "1519956757554790500", animated: true },
  VORTEXLINK: { name: "VORTEXLINK", emojiId: "1519956751456407675", animated: true },
  VORTEXtrabalho: { name: "VORTEXtrabalho", emojiId: "1519956745756086292", animated: true },
  VORTEX1187919283641135114: { name: "VORTEX1187919283641135114", emojiId: "1519956739972272158", animated: true },
  VORTEX1187919258877960: { name: "VORTEX1187919258877960", emojiId: "1519956734213488852", animated: true },
  VORTEX1187919201764118649: { name: "VORTEX1187919201764118649", emojiId: "1519956728462970992", animated: true },
  VORTEX1187919184420679: { name: "VORTEX1187919184420679", emojiId: "1519956722712842280", animated: true },
  VORTEX1479930855534106: { name: "VORTEX1479930855534106", emojiId: "1519956716970840124", animated: true },
  "782145discordoriginalykno": { name: "782145discordoriginalykno", emojiId: "1519956711119650846", animated: true },
  "420434discordstaffbadge": { name: "420434discordstaffbadge", emojiId: "1519956705356681456", animated: true },
  "701767discordsupportcom": { name: "701767discordsupportcom", emojiId: "1519956699354628096", animated: true }
};

export const SYSTEM_EMOJIS: readonly SystemEmojiDefinition[] = [
  { key: "visto", name: "visto", fallback: "✅", label: "Visto", description: "Confirmação, aprovação e sucesso." },
  { key: "trofeu_alt", name: "trofeu_alt", fallback: "🏅", label: "Troféu alternativo", description: "Destaques, benefícios e vantagens." },
  { key: "trofeu", name: "trofeu", fallback: "🏆", label: "Troféu", description: "Conquistas, cursos e rankings." },
  { key: "robo", name: "robo", fallback: "🤖", label: "Robô", description: "Bot, automação e módulos." },
  { key: "relogio", name: "relogio", fallback: "🕒", label: "Relógio", description: "Tempo, renovação e pendências." },
  { key: "prancheta", name: "prancheta", fallback: "📋", label: "Prancheta", description: "Painéis, listas e formulários." },
  { key: "prancheta_caneta", name: "prancheta_caneta", fallback: "📝", label: "Prancheta com caneta", description: "Edição, provas e solicitações." },
  { key: "porta", name: "porta", fallback: "🚪", label: "Porta", description: "Saída, voltar e fechar." },
  { key: "perigo", name: "perigo", fallback: "⚠️", label: "Perigo", description: "Alertas críticos e bloqueios." },
  { key: "link", name: "link", fallback: "🔗", label: "Link", description: "Links, convites e URLs." },
  { key: "liga", name: "liga", fallback: "🟢", label: "Liga", description: "Ativo, iniciar e online." },
  { key: "interrogacao", name: "interrogacao", fallback: "❓", label: "Interrogação", description: "Ajuda, dúvidas e suporte." },
  { key: "engrenagem", name: "engrenagem", fallback: "⚙️", label: "Engrenagem", description: "Configurações e administração." },
  { key: "homem", name: "homem", fallback: "👤", label: "Homem", description: "Usuário, membro e permissões." },
  { key: "folha", name: "folha", fallback: "📄", label: "Folha", description: "Documentos, regras e relatórios." },
  { key: "exclamacao", name: "exclamacao", fallback: "❗", label: "Exclamação", description: "Avisos, erros e atenção." },
  { key: "discord", name: "discord", fallback: "💬", label: "Discord", description: "Canais, servidor e comunidade." },
  { key: "dinheiro", name: "dinheiro", fallback: "💰", label: "Dinheiro", description: "Pagamentos, vendas e caixa." },
  { key: "prancheta_acertos", name: "prancheta_acertos", fallback: "☑️", label: "Prancheta de acertos", description: "Checklist, histórico e acertos." },
  { key: "calendario", name: "calendario", fallback: "📅", label: "Calendário", description: "Agendamento, datas e renovação." },
  { key: "caixa", name: "caixa", fallback: "📦", label: "Caixa", description: "Produtos, pacotes e entregas." },
  { key: "aniversario", name: "aniversario", fallback: "🎉", label: "Aniversário", description: "Boas-vindas, celebração e agradecimento." },
  { key: "alerta", name: "alerta", fallback: "⚠️", label: "Alerta", description: "Alertas e avisos importantes." },
  { key: "acessar", name: "acessar", fallback: "➡️", label: "Acessar", description: "Abrir, entrar e avançar." },
  { key: "nuvem", name: "nuvem", fallback: "☁️", label: "Nuvem", description: "Deploy, sincronização e backup." },
  { key: "arma", name: "arma", fallback: "🔫", label: "Arma", description: "Ações, operações policiais e FAC." },
  { key: "banco", name: "banco", fallback: "🏦", label: "Banco", description: "Banco Central e ações financeiras." },
  { key: "bandeira", name: "bandeira", fallback: "🏁", label: "Bandeira", description: "Resultado e encerramento de ações." },
  { key: "mais", name: "mais", fallback: "➕", label: "Mais", description: "Cadastrar, adicionar e criar." },
  { key: "salvar", name: "salvar", fallback: "💾", label: "Salvar", description: "Salvar configurações e alterações." },
  { key: "voltar", name: "voltar", fallback: "⬅️", label: "Voltar", description: "Retornar para painel anterior." },
  { key: "CHATBlack", name: "CHATBlack", fallback: "◼️", label: "CHATBlack", description: "Emoji preto do servidor." },
  { key: "CHATBlack_Crown", name: "CHATBlack_Crown", fallback: "👑", label: "CHATBlack Crown", description: "Coroa preta do servidor." },
  { key: "CHATBlack_hearts", name: "CHATBlack_hearts", aliases: ["CHATblack_hearts"], fallback: "🖤", label: "CHATBlack Hearts", description: "Corações pretos do servidor." },
  { key: "CHATBlack_knife", name: "CHATBlack_knife", aliases: ["CHATblack_knifee"], fallback: "🔪", label: "CHATBlack Knife", description: "Faca preta do servidor." },
  { key: "CHATBlack_gun", name: "CHATBlack_gun", fallback: "🔫", label: "CHATBlack Gun", description: "Arma preta do servidor." },
  { key: "CHATBlack_skull", name: "CHATBlack_skull", fallback: "💀", label: "CHATBlack Skull", description: "Caveira preta do servidor." },
  { key: "CHATBlack_error", name: "CHATBlack_error", aliases: ["CHATblack_error"], fallback: "❌", label: "CHATBlack Error", description: "Erro preto do servidor." },
  { key: "CHATBlack_insta", name: "CHATBlack_insta", fallback: "📷", label: "CHATBlack Insta", description: "Instagram preto do servidor." },
  { key: "CHATDiscord_Black", name: "CHATDiscord_Black", fallback: "💬", label: "CHATDiscord Black", description: "Discord preto do servidor." },
  { key: "CHATBlack_Broken_Heart", name: "CHATBlack_Broken_Heart", fallback: "💔", label: "CHATBlack Broken Heart", description: "Coração partido preto do servidor." },
  { key: "CHATBlack_1knife", name: "CHATBlack_1knife", fallback: "🗡️", label: "CHATBlack 1 Knife", description: "Faca alternativa preta do servidor." },
  { key: "CHATBlack_heart1", name: "CHATBlack_heart1", aliases: ["CHATblack_heart1"], fallback: "🖤", label: "CHATBlack Heart 1", description: "Coração preto alternativo do servidor." },
  { key: "CHATblack_gun_ak47black", name: "CHATblack_gun_ak47black", aliases: ["CHATie_black_gun_ak47bl"], fallback: "🔫", label: "CHATBlack AK47", description: "AK preto do servidor." },
  { key: "CHATLc_louis_vuitton_black", name: "CHATLc_louis_vuitton_black", aliases: ["CHATLC_louis_vuitton_black"], fallback: "◆", label: "CHAT Louis Vuitton Black", description: "Louis Vuitton preto do servidor." },
  { key: "fantasma", name: "fantasma", fallback: "👻", label: "Fantasma", description: "Fantasma do servidor." },
  { key: "CHATamor", name: "CHATamor", aliases: ["CHATAmor"], fallback: "❤️", label: "CHAT Amor", description: "Amor do servidor." },
  { key: "CHATmessage_love", name: "CHATmessage_love", fallback: "💌", label: "CHAT Message Love", description: "Mensagem de amor do servidor." },
  { key: "CHATBlack_Question_Mark", name: "CHATBlack_Question_Mark", fallback: "❓", label: "CHATBlack Question Mark", description: "Interrogação preta do servidor." },
  { key: "CHATblack_check", name: "CHATblack_check", fallback: "✅", label: "CHATBlack Check", description: "Check preto do servidor." },
  { key: "CHATblack_anguelaconfuso", name: "CHATblack_anguelaconfuso", fallback: "❓", label: "CHATBlack Confuso", description: "Emoji confuso preto do servidor." },
  { key: "CHATarma", name: "CHATarma", fallback: "🔫", label: "CHAT Arma", description: "Arma do servidor." },
  { key: "CHATdancando_com_arma", name: "CHATdancando_com_arma", fallback: "🔫", label: "CHAT Dançando com arma", description: "Ação armada do servidor." },
  { key: "CHATDinheiro", name: "CHATDinheiro", fallback: "💰", label: "CHAT Dinheiro", description: "Dinheiro do servidor." },
  { key: "CHATDinheiro1", name: "CHATDinheiro1", fallback: "💵", label: "CHAT Dinheiro 1", description: "Dinheiro alternativo do servidor." },
  { key: "CHATdinheiro2", name: "CHATdinheiro2", fallback: "💸", label: "CHAT Dinheiro 2", description: "Dinheiro alternativo do servidor." },
  { key: "VORTEXtesteDiscord_Black", name: "VORTEXtesteDiscord_Black", fallback: "💬", label: "VORTEX Discord Black", description: "Discord preto VORTEX." },
  { key: "VORTEXtesteBlack", name: "VORTEXtesteBlack", fallback: "◼️", label: "VORTEX Black", description: "Emoji preto VORTEX." },
  { key: "VORTEXtesteBlack_Question", name: "VORTEXtesteBlack_Question", fallback: "❓", label: "VORTEX Question", description: "Interrogação VORTEX." },
  { key: "VORTEXtesteblack_check", name: "VORTEXtesteblack_check", fallback: "✅", label: "VORTEX Check", description: "Check VORTEX." },
  { key: "VORTEXtesteDinheiro", name: "VORTEXtesteDinheiro", fallback: "💰", label: "VORTEX Dinheiro", description: "Dinheiro VORTEX." },
  { key: "VORTEXtesteDinheiro1", name: "VORTEXtesteDinheiro1", fallback: "💵", label: "VORTEX Dinheiro 1", description: "Dinheiro alternativo VORTEX." },
  { key: "VORTEX1505360210200049", name: "VORTEX1505360210200049", fallback: "🔹", label: "VORTEX 1505360210200049", description: "Emoji VORTEX do servidor." },
  { key: "VORTEXporta", name: "VORTEXporta", fallback: "🚪", label: "VORTEX Porta", description: "Porta VORTEX." },
  { key: "VORTEXanotaao", name: "VORTEXanotaao", fallback: "📝", label: "VORTEX Anotação", description: "Anotação VORTEX." },
  { key: "VORTEXavisos", name: "VORTEXavisos", fallback: "⚠️", label: "VORTEX Avisos", description: "Avisos VORTEX." },
  { key: "VORTEX1502459290164789", name: "VORTEX1502459290164789", fallback: "🔸", label: "VORTEX 1502459290164789", description: "Emoji VORTEX do servidor." },
  { key: "VORTEXPASTA", name: "VORTEXPASTA", fallback: "📁", label: "VORTEX Pasta", description: "Pasta VORTEX." },
  { key: "VORTEXLINK", name: "VORTEXLINK", fallback: "🔗", label: "VORTEX Link", description: "Link VORTEX." },
  { key: "VORTEXtrabalho", name: "VORTEXtrabalho", fallback: "💼", label: "VORTEX Trabalho", description: "Trabalho VORTEX." },
  { key: "VORTEX1187919283641135114", name: "VORTEX1187919283641135114", fallback: "▪️", label: "VORTEX 1187919283641135114", description: "Emoji VORTEX do servidor." },
  { key: "VORTEX1187919258877960", name: "VORTEX1187919258877960", fallback: "▪️", label: "VORTEX 1187919258877960", description: "Emoji VORTEX do servidor." },
  { key: "VORTEX1187919201764118649", name: "VORTEX1187919201764118649", fallback: "▪️", label: "VORTEX 1187919201764118649", description: "Emoji VORTEX do servidor." },
  { key: "VORTEX1187919184420679", name: "VORTEX1187919184420679", fallback: "▪️", label: "VORTEX 1187919184420679", description: "Emoji VORTEX do servidor." },
  { key: "VORTEX1479930855534106", name: "VORTEX1479930855534106", fallback: "▪️", label: "VORTEX 1479930855534106", description: "Emoji VORTEX do servidor." },
  { key: "782145discordoriginalykno", name: "782145discordoriginalykno", fallback: "💬", label: "Discord Original", description: "Discord original do servidor." },
  { key: "420434discordstaffbadge", name: "420434discordstaffbadge", fallback: "🛡️", label: "Discord Staff Badge", description: "Badge staff Discord." },
  { key: "701767discordsupportcom", name: "701767discordsupportcom", fallback: "💬", label: "Discord Support", description: "Suporte Discord." }
] as const;

export const SYSTEM_EMOJI_KEYS = SYSTEM_EMOJIS.map((item) => item.key) as SystemEmojiKey[];
export const SYSTEM_EMOJI_BY_KEY = new Map<SystemEmojiKey, SystemEmojiDefinition>(SYSTEM_EMOJIS.map((item) => [item.key, item]));

export function isSystemEmojiKey(value: string): value is SystemEmojiKey {
  return SYSTEM_EMOJI_BY_KEY.has(value as SystemEmojiKey);
}
