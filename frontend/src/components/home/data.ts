import { Activity, Bot, Code2, FileText, Gauge, Layers3, LockKeyhole, MessageSquareText, PlugZap, ShieldCheck, Workflow } from "lucide-react";
import type { PublicConnectedServersResponse, PublicMarketingFeature } from "./types";

export const SUPPORT_URL = "https://discord.gg/7WYzSwVBPm";
export const MONITORING_STATUS_URL = "https://nextech-status.discloud.app";
export const LANDING_SERVERS_REFRESH_MS = 60_000;

export const fallbackServers: PublicConnectedServersResponse = {
  generatedAt: new Date(0).toISOString(),
  servers: [],
  totalBots: 0,
  totalUniqueServers: 0
};

export const fallbackFeatures: [PublicMarketingFeature, PublicMarketingFeature, PublicMarketingFeature] = [
  {
    category: "Automação",
    fullDescription: "Crie sistemas de tickets, cursos, ações, verificações, logs e outros módulos integrados ao Discord e ao dashboard.",
    icon: "bot",
    id: "automation",
    shortDescription: "Automatize tarefas, processos e fluxos do seu servidor.",
    title: "Automação operacional"
  },
  {
    category: "Dashboard",
    fullDescription: "Controle configurações, canais, cargos, módulos, permissões e publicações sem precisar alterar código manualmente.",
    icon: "monitor",
    id: "central-control",
    shortDescription: "Gerencie bots, servidores e permissões em um único painel.",
    title: "Gestão centralizada"
  },
  {
    category: "Monitoramento",
    fullDescription: "Visualize bots online, servidores conectados, tempo de resposta, logs operacionais e informações essenciais da plataforma.",
    icon: "gauge",
    id: "monitoring",
    shortDescription: "Acompanhe status, desempenho e atividade em tempo real.",
    title: "Monitoramento contínuo"
  }
];

export const productModules = [
  "Dashboard",
  "Usuários",
  "Serviços",
  "Integrações",
  "Logs",
  "Configurações"
];

export const bentoFeatures = [
  {
    className: "lg:col-span-7",
    description: "Controle bots, servidores, permissões, canais e módulos dentro de uma interface única.",
    icon: Layers3,
    title: "Gestão centralizada"
  },
  {
    className: "lg:col-span-5",
    description: "Publique painéis, configure tickets, sincronize cargos e reduza tarefas repetitivas.",
    icon: Workflow,
    title: "Automação"
  },
  {
    className: "lg:col-span-4",
    description: "Acompanhe logs, permissões, sessões e ações sensíveis sem depender só do Discord.",
    icon: ShieldCheck,
    title: "Segurança"
  },
  {
    className: "lg:col-span-8",
    description: "Veja status, respostas, servidores conectados e atividade recente em tempo real.",
    icon: Activity,
    title: "Monitoramento"
  },
  {
    className: "lg:col-span-7",
    description: "Conecte API, bot, pagamentos, banco de dados, status público e serviços operacionais.",
    icon: PlugZap,
    title: "Integrações"
  },
  {
    className: "lg:col-span-5",
    description: "Use endpoints internos e públicos para expandir módulos sem perder controle.",
    icon: Code2,
    title: "API"
  }
];

export const workflowSteps = [
  { description: "Entre com Discord e valide seu acesso à plataforma.", title: "Crie sua conta" },
  { description: "Escolha módulos, permissões, canais, cargos e comportamento do bot.", title: "Configure seu ambiente" },
  { description: "Publique, monitore e ajuste tudo pela NexTech.", title: "Gerencie tudo pela NexTech" }
];

export const benefitItems = [
  "Controle todos os recursos dentro de uma única interface.",
  "Acompanhe status e atividades em tempo real.",
  "Automatize tarefas repetitivas.",
  "Gerencie acessos e operações importantes.",
  "Mantenha histórico detalhado das ações.",
  "Conecte serviços através da plataforma."
];

export const securityItems = [
  "Controle de acesso",
  "Logs operacionais",
  "Sessões protegidas",
  "Monitoramento",
  "Isolamento por servidor"
];

export const integrationNodes = [
  { icon: Bot, label: "Bot Discord" },
  { icon: Code2, label: "API" },
  { icon: MessageSquareText, label: "Tickets" },
  { icon: Gauge, label: "Status" },
  { icon: LockKeyhole, label: "Auth" },
  { icon: FileText, label: "Logs" }
];

export const faqItems = [
  {
    answer: "A NexTech centraliza configurações de bots, módulos, permissões, canais e monitoramento em um dashboard web conectado ao Discord.",
    question: "Como funciona a NexTech?"
  },
  {
    answer: "Use o botão de entrada com Discord. Quando sua conta tiver permissão, o sistema valida o acesso e direciona para o dashboard correto.",
    question: "Como faço para criar minha conta?"
  },
  {
    answer: "Os planos públicos usam o fluxo de checkout disponível na plataforma. Regras de cancelamento dependem do plano contratado e ficam vinculadas ao atendimento.",
    question: "Posso cancelar quando quiser?"
  },
  {
    answer: "O suporte acontece pelo Discord informado na página, preservando o fluxo já utilizado pelo projeto.",
    question: "Como funciona o suporte?"
  }
];
