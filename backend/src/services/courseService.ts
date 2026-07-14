import { randomUUID } from "node:crypto";
import { fixedSystemEmojiText } from "../config/systemEmojis";
import { getMongoCollections, type MongoCourse, type MongoCourseDepartment, type MongoCourseEnrollment, type MongoCourseExamQuestion, type MongoCourseImage, type MongoCoursePublication, type MongoCourseReport, type MongoCourseScheduleRequest, type MongoCourseSettings } from "../database/mongo";
import { emitRealtime } from "../realtime/events";

export const COURSES_MODULE_ID = "courses";
const DEFAULT_COURSE_CHANNEL_EXPIRATION_HOURS = 24;
const DEFAULT_COURSE_DEPARTMENTS = ["DP Fronteira", "DP Pier", "DP Juniper"];
const COURSE_DEPARTMENT_NAME_MIN = 2;
const COURSE_DEPARTMENT_NAME_MAX = 80;

export type CourseDashboard = {
  courses: CourseDto[];
  publications: CoursePublicationDto[];
  reports: CourseReportDto[];
  scheduleRequests: CourseScheduleRequestDto[];
  departments: CourseDepartmentDto[];
  settings: CourseSettingsDto;
  logs: CourseLogDto[];
  enrollments: CourseEnrollmentDto[];
};

export type CourseSettingsDto = ReturnType<typeof mapSettings>;
export type CourseDto = ReturnType<typeof mapCourse>;
export type CoursePublicationDto = ReturnType<typeof mapPublication>;
export type CourseDepartmentDto = ReturnType<typeof mapCourseDepartment>;
export type CourseScheduleRequestDto = ReturnType<typeof mapScheduleRequest>;
export type CourseReportDto = ReturnType<typeof mapReport>;
export type CourseLogDto = ReturnType<typeof mapLog>;
export type CourseImageDto = ReturnType<typeof mapImage>;
export type CourseEnrollmentDto = ReturnType<typeof mapEnrollment>;
type CourseSettingsUpdate = Partial<Omit<CourseSettingsDto, "id" | "botId" | "guildId" | "updatedAt" | "defaultExpirationHours">> & {
  defaultExpirationHours?: number | null;
};

export class CourseDepartmentError extends Error {
  constructor(public readonly code: "duplicate" | "invalid_name" | "not_found" | "inactive", message: string) {
    super(message);
  }
}

export async function getCoursesDashboard(botId: string | null, guildId: string): Promise<CourseDashboard> {
  const collections = await getMongoCollections();
  await ensureNpdTabletPrisionalCourse(botId, guildId);
  await ensureNpdModulationCourse(botId, guildId);
  await ensureNpdTrackingCourse(botId, guildId);
  await ensureNpdApproachCourse(botId, guildId);
  await ensureDefaultCourseDepartments(botId, guildId);
  const settings = await getCourseSettings(botId, guildId);
  const [courses, publications, scheduleRequests, reports, logs, enrollments, departments] = await Promise.all([
    collections.courses.find(scope(botId, guildId)).sort({ updatedAt: -1 }).toArray(),
    collections.coursePublications.find(scope(botId, guildId)).sort({ createdAt: -1 }).limit(50).toArray(),
    collections.courseScheduleRequests.find(scope(botId, guildId)).sort({ createdAt: -1 }).limit(50).toArray(),
    collections.courseReports.find(scope(botId, guildId)).sort({ createdAt: -1 }).limit(50).toArray(),
    collections.courseLogs.find(scope(botId, guildId)).sort({ createdAt: -1 }).limit(25).toArray(),
    collections.courseEnrollments.find(scope(botId, guildId)).sort({ updatedAt: -1 }).limit(500).toArray(),
    collections.courseDepartments.find(scope(botId, guildId)).sort({ active: -1, name: 1 }).toArray()
  ]);

  return {
    courses: courses.map(mapCourse),
    publications: publications.map(mapPublication),
    reports: reports.map(mapReport),
    scheduleRequests: scheduleRequests.map(mapScheduleRequest),
    departments: departments.map(mapCourseDepartment),
    settings,
    logs: logs.map(mapLog),
    enrollments: enrollments.map(mapEnrollment)
  };
}

async function ensureNpdTabletPrisionalCourse(botId: string | null, guildId: string) {
  const { courses, courseExamSettings, courseExamQuestions } = await getMongoCollections();
  const now = new Date();
  const existing = await courses.findOne({
    ...scope(botId, guildId),
    $or: [
      { code: "npd-tablet-prisional" },
      { code: "npd_tablet_prisional" },
      { code: "curso-tablet-prisional-npd" },
      { name: "CURSO DE TABLET E PRISIONAL - NPD" },
      { name: "Curso de Tablet e Prisional — NPD" },
      { name: "Curso de Tablet e Prisional - NPD" }
    ]
  });
  const courseId = existing?._id ?? randomUUID();
  const description = "Esta prova foi desenvolvida com o objetivo de capacitar e instruir todos os policiais do North Police Department a realizar a instrução padrão com excelência.";
  if (!existing) {
    await courses.insertOne({
      _id: courseId,
      botId,
      guildId,
      name: "CURSO DE TABLET E PRISIONAL - NPD",
      code: "npd-tablet-prisional",
      description,
      emoji: null,
      color: "#FFD500",
      bannerUrl: null,
      proofBannerUrl: null,
      footerImageUrl: null,
      thumbnailUrl: null,
      imagePosition: "top",
      publishText: null,
      proofInstructionText: null,
      startedText: null,
      cancelledText: null,
      buttonLabels: {
        cancel: "Cancelar Curso",
        enter: "Entrar no Curso",
        leave: "Sair do Curso",
        start: "Realizar Prova"
      },
      instructorUserIds: [],
      instructorRoleIds: [],
      allowGeneralInstructorRoles: true,
      publishChannelId: null,
      maxStudents: 30,
      location: null,
      defaultSchedule: null,
      active: false,
      createdBy: "system:seed",
      updatedBy: "system:seed",
      createdAt: now,
      updatedAt: now
    });
  } else if (
    existing.code !== "npd-tablet-prisional"
    || existing.buttonLabels?.start !== "Realizar Prova"
    || !existing.description
    || existing.updatedBy === "system:seed"
  ) {
    const seedOwned = existing.updatedBy === "system:seed";
    await courses.updateOne(
      { _id: existing._id, ...scope(botId, guildId) },
      {
        $set: {
          code: "npd-tablet-prisional",
          ...(seedOwned ? {
            color: "#FFD500",
            description,
            name: "CURSO DE TABLET E PRISIONAL - NPD",
            updatedBy: "system:seed"
          } : {
            description: existing.description || description
          }),
          buttonLabels: {
            ...existing.buttonLabels,
            start: "Realizar Prova"
          },
          updatedAt: now
        }
      }
    );
  }

  await courseExamSettings.updateOne(
    { ...scope(botId, guildId), courseId },
    {
      $setOnInsert: {
        _id: randomUUID(),
        botId,
        guildId,
        courseId,
        enabled: false,
        minScore: 70,
        maxTimeMinutes: null,
        correctionChannelId: null,
        resultChannelId: null,
        temporaryCategoryId: null,
        logChannelId: null,
        deleteWrittenAnswers: false,
        allowCurrentQuestionReview: false,
        initialMessage: "Bem-vindo à prova do Curso de Tablet e Prisional — NPD. Leia cada pergunta com atenção.",
        finalMessage: "Deseja realmente finalizar sua prova? Depois da finalização, as respostas não poderão ser alteradas.",
        approvalMessage: "Você foi aprovado na prova do Curso de Tablet e Prisional — NPD.",
        rejectionMessage: "Você foi reprovado na prova do Curso de Tablet e Prisional — NPD.",
        manualQuestionMaxScore: 0,
        manualApproval: true,
        automaticApproval: false,
        releaseMode: "immediate",
        releaseAt: null,
        attemptLimit: 1,
        allowAnswerChange: false,
        showAnswersAfterExam: false,
        version: 1,
        examKey: "npd-tablet-prisional-v1",
        externalLinkEnabled: false,
        externalLinkText: "Acessar material da prova",
        externalLinkUrl: null,
        externalLinkDescription: null,
        externalLinkEmoji: null,
        updatedAt: now,
        updatedBy: "system:seed"
      }
    },
    { upsert: true }
  );

  const existingQuestions = await courseExamQuestions.find({ ...scope(botId, guildId), courseId }).toArray();
  const existingByNumber = new Map(existingQuestions.map((question) => [question.questionNumber ?? question.order + 1, question]));
  const existingByPrompt = new Map(existingQuestions.map((question) => [normalizeCourseSeedText(question.prompt), question]));
  const nextQuestions = npdTabletPrisionalQuestions(courseId, botId, guildId, now, existingByNumber, existingByPrompt);

  for (const question of nextQuestions) {
    const existingQuestion = existingByNumber.get(question.questionNumber ?? question.order + 1) ?? existingByPrompt.get(normalizeCourseSeedText(question.prompt));
    if (!existingQuestion) {
      await courseExamQuestions.insertOne(question);
      continue;
    }
    if (existingQuestion.updatedBy !== "system:seed") continue;
    await courseExamQuestions.updateOne(
      { _id: existingQuestion._id, ...scope(botId, guildId), courseId },
      {
        $set: {
          active: question.active,
          alternatives: question.alternatives,
          correctAlternativeId: question.correctAlternativeId,
          correctAlternativeIds: question.correctAlternativeIds,
          description: question.description,
          order: question.order,
          placeholder: question.placeholder,
          points: question.points,
          prompt: question.prompt,
          questionNumber: question.questionNumber,
          title: question.title,
          type: question.type,
          updatedAt: now,
          updatedBy: "system:seed"
        }
      }
    );
  }
}

function npdTabletPrisionalQuestions(
  courseId: string,
  botId: string | null,
  guildId: string,
  now: Date,
  existingByNumber: Map<number, MongoCourseExamQuestion>,
  existingByPrompt: Map<string, MongoCourseExamQuestion>
) {
  const rows: Array<{ prompt: string; instruction?: string; type: "selection" | "multiple"; alternatives: string[] }> = [
    { prompt: "Um boletim de ocorrência deve conter os seguintes aspectos para estar dentro do padrão:", instruction: "Assinale as alternativas corretas.", type: "multiple", alternatives: ["Título", "Descrição objetiva e completa", "Foto do veículo, se houver", "Foto da caixa com os itens ilícitos", "Foto dos documentos, ID e passaporte"] },
    { prompt: "Quais são os procedimentos básicos para realizar o prisional de um indivíduo?", instruction: "Assinale a alternativa incorreta.", type: "selection", alternatives: ["Retirar adornos", "Algemar", "Revistar, em caso de flagrante", "Tirar foto do indivíduo", "Recolher apenas a identidade", "Recolher identidade e passaporte"] },
    { prompt: "Onde as caixas com itens ilícitos devem ser descartadas?", instruction: "Assinale a alternativa correta.", type: "selection", alternatives: ["No porta-malas da viatura", "No baú de evidências", "Devolvida ao indivíduo", "No porta-luvas da viatura", "Jogar fora utilizando a opção “DESCARTAR” do inventário"] },
    { prompt: "Selecione o crime inafiançável:", instruction: "Assinale a alternativa correta.", type: "selection", alternatives: ["Roubo a Caixa Registradora", "Tráfico de Drogas", "Roubo a Residência", "Desacato", "Fuga de Abordagem"] },
    { prompt: "Um indivíduo foi capturado em uma QRU de Tráfico de Drogas e, após revistá-lo, você encontrou uma Five-7, além das drogas. O indivíduo solicita a utilização do sistema de fiança e você aplica a fiança após a solicitação. Essa conduta está de acordo com o manual da NPD?", type: "selection", alternatives: ["Sim. O indivíduo possui direito de pagar fiança por se tratar de uma QRU de Venda de Drogas", "Não. O porte de arma torna o crime inafiançável."] },
    { prompt: "Um indivíduo, durante o prisional de uma QRU de Caixa Registradora, solicitou a utilização do Sistema de Fianças. Porém, existe apenas você como maior patente disponível no momento, sendo Officer. Como você daria continuidade?", instruction: "Assinale a alternativa correta.", type: "selection", alternatives: ["Explicaria que o sistema de fiança não estava funcionando", "Explicaria que, no momento, não existem oficiais com as patentes necessárias para autorizar a utilização do sistema", "Aplicaria a fiança", "Aplicaria a fiança e explicaria nas observações do boletim que não havia uma patente superior no momento do prisional"] },
    { prompt: "Você está apreendendo um veículo com placa irregular. Quais são os procedimentos?", instruction: "Assinale as alternativas corretas.", type: "multiple", alternatives: ["Retirar a placa na rua", "Levar o veículo até um departamento da NPD", "Comprar uma chave de fenda e retirar a placa", "Solicitar uma patente superior", "Tirar foto do veículo apenas depois de retirar a placa"] },
    { prompt: "Em quais situações de prisional devemos contatar um membro da investigativa, D.U?", instruction: "Assinale as alternativas corretas.", type: "multiple", alternatives: ["Porte de arma de baixo calibre", "Porte de 50 ou mais unidades de drogas", "Utilização de uniformes", "Porte de 20.000 ou mais em dinheiro sujo", "Porte de arma de alto calibre"] },
    { prompt: "Um indivíduo chegou à NPD para liberar um veículo apreendido. Marque abaixo os procedimentos corretos.", instruction: "Assinale as alternativas corretas.", type: "multiple", alternatives: ["Solicitar a documentação do indivíduo e do veículo, incluindo identidade e passaporte", "Tirar foto do indivíduo", "Realizar o boletim em qualquer lugar", "Verificar possíveis multas com pagamentos pendentes", "Verificar se a pessoa está procurada"] },
    { prompt: "Em uma QRU de Tráfico de Drogas, o indivíduo tentou fugir, mas foi capturado com 50.000 dólares em dinheiro sujo e 100 unidades de todos os tipos de drogas. Antes de ser preso, ele forneceu informações sobre onde conseguiu as drogas e colaborou com a investigativa. Quais crimes ou atenuantes devem ser aplicados?", instruction: "Assinale as alternativas corretas.", type: "multiple", alternatives: ["Tráfico de Drogas", "Porte de arma de baixo calibre", "Porte de dinheiro sujo", "Desacato", "Colaboração com D.U."] }
  ];
  return rows.map((row, index) => {
    const optionPrefix = `q${String(index + 1).padStart(2, "0")}_option_`;
    const alternatives = row.alternatives.map((text, optionIndex) => ({
      id: `${optionPrefix}${String(optionIndex + 1).padStart(2, "0")}`,
      text,
      value: `${optionPrefix}${String(optionIndex + 1).padStart(2, "0")}`,
      score: 0,
      isCorrect: false,
      order: optionIndex
    }));
    const existing = existingByNumber.get(index + 1) ?? existingByPrompt.get(normalizeCourseSeedText(row.prompt));
    const preservedCorrectIds = preserveCourseSeedCorrectIds(existing, alternatives);
    const points = existing?.points && existing.points > 0 ? existing.points : 10;
    return {
      _id: existing?._id ?? randomUUID(),
      botId,
      guildId,
      courseId,
      order: index,
      questionNumber: index + 1,
      type: existing?.type ?? row.type,
      prompt: row.prompt,
      title: row.prompt,
      description: row.instruction ?? null,
      points,
      alternatives: alternatives.map((alternative) => ({ ...alternative, isCorrect: preservedCorrectIds.includes(alternative.id), score: preservedCorrectIds.includes(alternative.id) ? points : 0 })),
      correctAlternativeId: (existing?.type ?? row.type) === "selection" ? preservedCorrectIds[0] ?? null : null,
      correctAlternativeIds: (existing?.type ?? row.type) === "multiple" ? preservedCorrectIds : [],
      correctText: existing?.correctText ?? null,
      placeholder: null,
      active: true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      updatedBy: "system:seed"
    };
  });
}

async function ensureNpdModulationCourse(botId: string | null, guildId: string) {
  const { courses, courseExamSettings, courseExamQuestions } = await getMongoCollections();
  const now = new Date();
  const existing = await courses.findOne({
    ...scope(botId, guildId),
    $or: [
      { code: "npd_modulacao" },
      { code: "curso-modulacao-npd" },
      { code: "npd-modulacao" },
      { name: "Curso de Modulação" }
    ]
  });
  const courseId = existing?._id ?? randomUUID();
  const description = "Curso de Modulação da NPD. Prova avaliativa com 10 questões sobre comunicação, códigos operacionais, QRL, QRV e procedimentos de rádio.";
  if (!existing) {
    await courses.insertOne({
      _id: courseId,
      botId,
      guildId,
      name: "Curso de Modulação",
      code: "npd_modulacao",
      description,
      emoji: null,
      color: "#FFD500",
      bannerUrl: null,
      proofBannerUrl: null,
      footerImageUrl: null,
      thumbnailUrl: null,
      imagePosition: "top",
      publishText: null,
      proofInstructionText: null,
      startedText: null,
      cancelledText: null,
      buttonLabels: {
        cancel: "Cancelar Curso",
        enter: "Entrar no Curso",
        leave: "Sair do Curso",
        start: "Iniciar Prova"
      },
      instructorUserIds: [],
      instructorRoleIds: [],
      allowGeneralInstructorRoles: true,
      publishChannelId: null,
      maxStudents: 30,
      location: null,
      defaultSchedule: null,
      active: false,
      createdBy: "system:seed",
      updatedBy: "system:seed",
      createdAt: now,
      updatedAt: now
    });
  } else if (
    existing.code !== "npd_modulacao"
    || existing.buttonLabels?.start !== "Iniciar Prova"
    || !existing.description
    || existing.updatedBy === "system:seed"
  ) {
    const seedOwned = existing.updatedBy === "system:seed";
    await courses.updateOne(
      { _id: existing._id, ...scope(botId, guildId) },
      {
        $set: {
          code: "npd_modulacao",
          ...(seedOwned ? {
            color: "#FFD500",
            description,
            name: "Curso de Modulação",
            updatedBy: "system:seed"
          } : {
            description: existing.description || description
          }),
          buttonLabels: {
            ...existing.buttonLabels,
            start: "Iniciar Prova"
          },
          updatedAt: now
        }
      }
    );
  }

  await courseExamSettings.updateOne(
    { ...scope(botId, guildId), courseId },
    {
      $setOnInsert: {
        _id: randomUUID(),
        botId,
        guildId,
        courseId,
        enabled: false,
        minScore: 70,
        maxTimeMinutes: null,
        correctionChannelId: null,
        resultChannelId: null,
        temporaryCategoryId: null,
        logChannelId: null,
        deleteWrittenAnswers: false,
        allowCurrentQuestionReview: false,
        initialMessage: "Bem-vindo à prova do Curso de Modulação — NPD. Leia cada pergunta com atenção.",
        finalMessage: "Deseja realmente finalizar sua prova? Depois da finalização, as respostas não poderão ser alteradas.",
        approvalMessage: "Parabéns! Você concluiu e foi aprovado na prova do Curso de Modulação da NPD.",
        rejectionMessage: "Sua prova foi concluída, mas a nota mínima necessária não foi atingida.",
        manualQuestionMaxScore: 0,
        manualApproval: true,
        automaticApproval: false,
        releaseMode: "immediate",
        releaseAt: null,
        attemptLimit: 1,
        allowAnswerChange: false,
        showAnswersAfterExam: false,
        version: 1,
        examKey: "curso-modulacao-npd-v1",
        externalLinkEnabled: false,
        externalLinkText: "Acessar material da prova",
        externalLinkUrl: null,
        externalLinkDescription: null,
        externalLinkEmoji: null,
        updatedAt: now,
        updatedBy: "system:seed"
      }
    },
    { upsert: true }
  );

  const existingQuestions = await courseExamQuestions.find({ ...scope(botId, guildId), courseId }).toArray();
  const existingByNumber = new Map(existingQuestions.map((question) => [question.questionNumber ?? question.order + 1, question]));
  const existingByPrompt = new Map(existingQuestions.map((question) => [normalizeCourseSeedText(question.prompt), question]));
  const nextQuestions = npdModulationQuestions(courseId, botId, guildId, now, existingByNumber, existingByPrompt);

  for (const question of nextQuestions) {
    const existingQuestion = existingByNumber.get(question.questionNumber ?? question.order + 1) ?? existingByPrompt.get(normalizeCourseSeedText(question.prompt));
    if (!existingQuestion) {
      await courseExamQuestions.insertOne(question);
      continue;
    }
    if (existingQuestion.updatedBy !== "system:seed") continue;
    await courseExamQuestions.updateOne(
      { _id: existingQuestion._id, ...scope(botId, guildId) },
      {
        $set: {
          order: question.order,
          questionNumber: question.questionNumber,
          type: question.type,
          prompt: question.prompt,
          title: question.title,
          description: question.description,
          points: question.points,
          alternatives: question.alternatives,
          correctAlternativeId: question.correctAlternativeId,
          correctAlternativeIds: question.correctAlternativeIds,
          placeholder: question.placeholder,
          active: true,
          updatedAt: now,
          updatedBy: "system:seed"
        }
      }
    );
  }
}

function npdModulationQuestions(
  courseId: string,
  botId: string | null,
  guildId: string,
  now: Date,
  existingByNumber: Map<number, MongoCourseExamQuestion>,
  existingByPrompt: Map<string, MongoCourseExamQuestion>
) {
  const rows: Array<{ prompt: string; instruction: string; type: "selection" | "multiple"; alternatives: string[] }> = [
    { prompt: "Quais métodos a seguir podem ajudar a manter uma modulação clara e objetiva?", instruction: "Assinale as alternativas corretas.", type: "multiple", alternatives: ["Pensar antes de falar", "Estruturar informações", "Teste de frequência no início do expediente", "Evitar modulações com informações desnecessárias", "Treinamento diário"] },
    { prompt: "Sua QSV necessita de conserto e os mecânicos estão disponíveis apenas na Capital. Selecione a opção mais adequada para informar o QRL:", instruction: "Assinale a alternativa correta.", type: "selection", alternatives: ["/cp Badge + QRL", "/cp QRA + QRL + Motivo", "/cp Badge + QRL + Motivo", "/cp QRA + QRL"] },
    { prompt: "Ao adentrar em serviço, você precisa se identificar no /CP para que os oficiais saibam que você está disponível para prestar apoio. Selecione a opção mais adequada para informar o QRV:", instruction: "Assinale a alternativa correta.", type: "selection", alternatives: ["/cp QRA + QRV", "/cp QRV", "/cp QRV + QRA", "/cp Badge + QRV"] },
    { prompt: "Você está em um acompanhamento de um possível cód. 5, com visual armado. Quais informações são de prioridade na modulação?", instruction: "Assinale a alternativa incorreta.", type: "selection", alternatives: ["Cor do veículo", "Cor da vestimenta", "Modulação do local", "Conversas paralelas durante a modulação", "Modulação solicitando apoio"] },
    { prompt: "Dentre os QTH's citados abaixo, qual deles não faz parte da Jurisdição da NPD?", instruction: "Assinale a alternativa correta.", type: "selection", alternatives: ["Marinas Beach", "Lenhador", "Mergulhador", "Madereira", "Sandy Shores"] },
    { prompt: "Selecione o significado correto do código ADAM de patrulhamento.", instruction: "Assinale a alternativa correta.", type: "selection", alternatives: ["Unidade composta por apenas um oficial", "Unidade investigativa composta por um oficial", "Unidade composta por cão policial", "Unidade composta por dois oficiais ou mais", "Unidade composta por motocicletas"] },
    { prompt: "Você está a caminho do HP e precisa anunciar QRL com o alfabeto fonético. Qual seria a representação correta?", instruction: "Assinale a alternativa correta.", type: "selection", alternatives: ["Tango Zulu", "Delta Papa", "Charlie Alfa", "Hotel Papa", "Alfa November"] },
    { prompt: "Houve um Roubo ao Banco Paleto e o oficial que realizou o primeiro contato está solicitando nomes para participar da ação. Suponhamos que você já participou de uma ação. Qual o informe que você deverá mandar no /cp?", instruction: "Assinale a alternativa correta.", type: "selection", alternatives: ["/cp QRA + NF", "/cp QRA + JF", "/cp Badge + NF", "/cp Badge + JF", "/cp QRA"] },
    { prompt: "A NPD possui jurisdição sobre diversos territórios no norte.", instruction: "Assinale a alternativa incorreta.", type: "selection", alternatives: ["Paleto Bay", "Grapeseed", "Vila portugal", "Vinewood", "Kartódromo"] },
    { prompt: "Você recebeu uma denúncia de uma QRU de Roubo a Veículos, sem visual confirmado, e precisa pedir apoio para realizar abordagem. Como você iria categorizar a intensidade da abordagem via rádio POLICIANPD?", instruction: "Assinale a alternativa correta.", type: "selection", alternatives: ["Abordagem de código 1", "Abordagem de código 2", "Abordagem de código 3", "Abordagem de código 5", "Abordagem de código 0"] }
  ];

  return rows.map((row, index) => {
    const optionPrefix = `q${String(index + 1).padStart(2, "0")}_option_`;
    const alternatives = row.alternatives.map((text, optionIndex) => ({
      id: `${optionPrefix}${String(optionIndex + 1).padStart(2, "0")}`,
      text,
      value: `${optionPrefix}${String(optionIndex + 1).padStart(2, "0")}`,
      score: 0,
      isCorrect: false,
      order: optionIndex
    }));
    const existing = existingByNumber.get(index + 1) ?? existingByPrompt.get(normalizeCourseSeedText(row.prompt));
    const preservedCorrectIds = preserveCourseSeedCorrectIds(existing, alternatives);
    const type = row.type;
    return {
      _id: existing?._id ?? randomUUID(),
      botId,
      guildId,
      courseId,
      order: index,
      questionNumber: index + 1,
      type,
      prompt: row.prompt,
      title: row.prompt,
      description: row.instruction,
      points: existing?.points && existing.points > 0 ? existing.points : 10,
      alternatives: alternatives.map((alternative) => ({ ...alternative, isCorrect: preservedCorrectIds.includes(alternative.id), score: preservedCorrectIds.includes(alternative.id) ? (existing?.points && existing.points > 0 ? existing.points : 10) : 0 })),
      correctAlternativeId: type === "selection" ? preservedCorrectIds[0] ?? null : null,
      correctAlternativeIds: type === "multiple" ? preservedCorrectIds : [],
      placeholder: null,
      active: true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      updatedBy: "system:seed"
    };
  });
}

async function ensureNpdTrackingCourse(botId: string | null, guildId: string) {
  const { courses, courseExamSettings, courseExamQuestions } = await getMongoCollections();
  const now = new Date();
  const existing = await courses.findOne({
    ...scope(botId, guildId),
    $or: [
      { code: "npd_acompanhamento" },
      { code: "curso-acompanhamento-npd" },
      { code: "npd-acompanhamento" },
      { name: "CURSO DE ACOMPANHAMENTO - NPD" },
      { name: "Curso de Acompanhamento - NPD" }
    ]
  });
  const courseId = existing?._id ?? randomUUID();
  const description = "Esta prova foi desenvolvida com o objetivo de capacitar e instruir todos os policiais do North Police Department a realizar a instrução padrão e com excelência, para que nosso batalhão mantenha o alto padrão no nosso procedimento de acompanhamento.\n\nApós a aprovação no curso, será esperado e cobrado a execução plena e adequada de todos os conteúdos abordados nesta apostila. Uma vez que o curso foi registrado na planilha, falhas no procedimento estarão sujeitas a punições, além da reciclagem do respectivo curso.";

  if (!existing) {
    await courses.insertOne({
      _id: courseId,
      botId,
      guildId,
      name: "CURSO DE ACOMPANHAMENTO - NPD",
      code: "npd_acompanhamento",
      description,
      emoji: null,
      color: "#b91c1c",
      bannerUrl: null,
      proofBannerUrl: null,
      footerImageUrl: null,
      thumbnailUrl: null,
      imagePosition: "top",
      publishText: null,
      proofInstructionText: null,
      startedText: null,
      cancelledText: null,
      buttonLabels: {
        cancel: "Cancelar Curso",
        enter: "Entrar no Curso",
        leave: "Sair do Curso",
        start: "Realizar Prova"
      },
      instructorUserIds: [],
      instructorRoleIds: [],
      allowGeneralInstructorRoles: true,
      publishChannelId: null,
      maxStudents: 30,
      location: null,
      defaultSchedule: null,
      active: false,
      createdBy: "system:seed",
      updatedBy: "system:seed",
      createdAt: now,
      updatedAt: now
    });
  } else if (
    existing.code !== "npd_acompanhamento"
    || existing.buttonLabels?.start !== "Realizar Prova"
    || !existing.description
    || existing.updatedBy === "system:seed"
  ) {
    const seedOwned = existing.updatedBy === "system:seed";
    await courses.updateOne(
      { _id: existing._id, ...scope(botId, guildId) },
      {
        $set: {
          code: "npd_acompanhamento",
          ...(seedOwned ? {
            color: "#FFD500",
            description,
            name: "CURSO DE ACOMPANHAMENTO - NPD",
            updatedBy: "system:seed"
          } : {
            description: existing.description || description
          }),
          buttonLabels: {
            ...existing.buttonLabels,
            start: "Realizar Prova"
          },
          updatedAt: now
        }
      }
    );
  }

  await courseExamSettings.updateOne(
    { ...scope(botId, guildId), courseId },
    {
      $setOnInsert: {
        _id: randomUUID(),
        botId,
        guildId,
        courseId,
        enabled: false,
        minScore: 70,
        maxTimeMinutes: null,
        correctionChannelId: null,
        resultChannelId: null,
        temporaryCategoryId: null,
        logChannelId: null,
        deleteWrittenAnswers: false,
        allowCurrentQuestionReview: false,
        initialMessage: "Bem-vindo à prova do CURSO DE ACOMPANHAMENTO - NPD. Leia cada pergunta com atenção.",
        finalMessage: "Tem certeza de que deseja finalizar? Depois da confirmação, as respostas não poderão ser alteradas.",
        approvalMessage: "Você foi aprovado no CURSO DE ACOMPANHAMENTO - NPD.",
        rejectionMessage: "Sua prova foi concluída, mas a nota mínima necessária não foi atingida.",
        manualQuestionMaxScore: 0,
        manualApproval: true,
        automaticApproval: false,
        releaseMode: "immediate",
        releaseAt: null,
        attemptLimit: 1,
        allowAnswerChange: false,
        showAnswersAfterExam: false,
        version: 1,
        examKey: "npd-acompanhamento-v1",
        externalLinkEnabled: false,
        externalLinkText: "Acessar material da prova",
        externalLinkUrl: null,
        externalLinkDescription: null,
        externalLinkEmoji: null,
        updatedAt: now,
        updatedBy: "system:seed"
      }
    },
    { upsert: true }
  );

  const existingQuestions = await courseExamQuestions.find({ ...scope(botId, guildId), courseId }).toArray();
  const existingByNumber = new Map(existingQuestions.map((question) => [question.questionNumber ?? question.order + 1, question]));
  const existingByPrompt = new Map(existingQuestions.map((question) => [normalizeCourseSeedText(question.prompt), question]));
  const nextQuestions = npdTrackingQuestions(courseId, botId, guildId, now, existingByNumber, existingByPrompt);

  for (const question of nextQuestions) {
    const existingQuestion = existingByNumber.get(question.questionNumber ?? question.order + 1) ?? existingByPrompt.get(normalizeCourseSeedText(question.prompt));
    if (!existingQuestion) await courseExamQuestions.insertOne(question);
    else if (existingQuestion.updatedBy === "system:seed") {
      await courseExamQuestions.updateOne(
        { _id: existingQuestion._id, ...scope(botId, guildId), courseId },
        {
          $set: {
            active: question.active,
            alternatives: question.alternatives,
            correctAlternativeId: question.correctAlternativeId,
            correctAlternativeIds: question.correctAlternativeIds,
            description: question.description,
            order: question.order,
            placeholder: question.placeholder,
            points: question.points,
            prompt: question.prompt,
            questionNumber: question.questionNumber,
            title: question.title,
            type: question.type,
            updatedAt: now,
            updatedBy: "system:seed"
          }
        }
      );
    }
  }
}

function npdTrackingQuestions(
  courseId: string,
  botId: string | null,
  guildId: string,
  now: Date,
  existingByNumber: Map<number, MongoCourseExamQuestion>,
  existingByPrompt: Map<string, MongoCourseExamQuestion>
) {
  const rows: Array<{ prompt: string; instruction: string; type: "selection" | "multiple"; alternatives: string[] }> = [
    { prompt: "Como é dividida a estrutura de um acompanhamento?", instruction: "Assinale a alternativa correta.", type: "selection", alternatives: ["Viatura primária e secundária com apoio DAF", "Viatura primária, secundária, terciária e sem apoio DAF", "Viatura primária, secundária, terciária e apoio DAF", "Viatura primária com apoio DAF"] },
    { prompt: "Quais as funções da viatura primária em um acompanhamento?", instruction: "Assinale as alternativas corretas.", type: "multiple", alternatives: ["Modular", "Dar pit", "Responsável pelo cerco caso necessário", "Antecipação de movimentos", "Manter contato visual"] },
    { prompt: "Quais as funções da viatura secundária em um acompanhamento?", instruction: "Assinale as alternativas incorretas.", type: "multiple", alternatives: ["Modular", "Dar pit", "Responsável pelo cerco caso necessário", "Antecipação de movimentos", "Manter contato visual"] },
    { prompt: "Quais as funções da viatura terciária em um acompanhamento?", instruction: "Assinale a alternativa correta.", type: "selection", alternatives: ["Modular", "Dar pit", "Responsável pelo cerco caso necessário", "Antecipação de movimentos", "Manter contato visual"] },
    { prompt: "Quais as funções do DAF em um acompanhamento?", instruction: "Assinale as alternativas corretas.", type: "multiple", alternatives: ["Dar pit", "Realizar manobras arriscadas", "Modular", "Responsável pelo cerco caso necessário", "Manter contato visual"] },
    { prompt: "Durante um acompanhamento de uma ação fechada de Roubo a Joalheria, um dos veículos ficam sem gasolina e iniciam fuga a pé. Como você reagiria?", instruction: "Assinale as alternativas incorretas.", type: "multiple", alternatives: ["Descer do veículo imediatamente para acompanhá-lo a pé", "Adiantar com uma viatura, descer do veículo, dar cabeçada e algemar", "Trancar a viatura", "Usar taser caso o indivíduo esteja passando rádio", "Abrir código 5 nos indivíduos"] },
    { prompt: "Durante um acompanhamento já completo com 3 unidades sendo 1 MARY, 2 FAST e 1 DAF em uma QRU de Roubo a Caixa Registradora, o indivíduo se direciona sentido a Capital. Qual o procedimento correto a ser aplicado nessa situação?", instruction: "Assinale a alternativa correta.", type: "selection", alternatives: ["Explodir o veículo", "Contactar a PMC através da rádio POLICIALIVIO e furar os pneus", "Dar pit na tentativa de evitar que o veículo chegue até a Capital", "Contactar a PMC através da rádio POLICIALIVIO e solicitar o apoio de 3 unidades", "Dar QTA após o veículo chegar na Capital"] },
    { prompt: "Durante um acompanhamento de um Tráfico de Drogas você caiu da moto ou capotou a QSV quatro rodas. Como você reagiria após essa situação?", instruction: "Assinale a alternativa correta.", type: "selection", alternatives: ["Sairia imediatamente do acompanhamento", "Subiria na moto / Descapotaria a QSV e seguiria o acompanhamento normalmente", "Voltaria para a NPD e pegaria outra QSV", "Informaria QTA + motivo, se retirando do acompanhamento"] },
    { prompt: "Quantas MARY’s são necessárias para fechar uma unidade?", instruction: "Assinale a alternativa correta.", type: "selection", alternatives: ["1", "2", "3", "4", "5"] },
    { prompt: "Em qual situação deve-se retirar o dispositivo de NITRO quando aplicado no veículo dos indivíduos?", instruction: "Assinale a alternativa correta.", type: "selection", alternatives: ["Em uma abordagem de código 1", "Em uma abordagem de código 2", "Quando o veículo passa por você em alta velocidade usando NITRO", "Em uma ação que haja tentativa de fuga"] }
  ];

  return rows.map((row, index) => {
    const optionPrefix = `q${String(index + 1).padStart(2, "0")}_option_`;
    const alternatives = row.alternatives.map((text, optionIndex) => ({
      id: `${optionPrefix}${String(optionIndex + 1).padStart(2, "0")}`,
      text,
      value: `${optionPrefix}${String(optionIndex + 1).padStart(2, "0")}`,
      score: 0,
      isCorrect: false,
      order: optionIndex
    }));
    const existing = existingByNumber.get(index + 1) ?? existingByPrompt.get(normalizeCourseSeedText(row.prompt));
    const preservedCorrectIds = preserveCourseSeedCorrectIds(existing, alternatives);
    const points = existing?.points && existing.points > 0 ? existing.points : 10;
    return {
      _id: existing?._id ?? randomUUID(),
      botId,
      guildId,
      courseId,
      order: index,
      questionNumber: index + 1,
      type: existing?.type ?? row.type,
      prompt: row.prompt,
      title: row.prompt,
      description: row.instruction,
      points,
      alternatives: alternatives.map((alternative) => ({ ...alternative, isCorrect: preservedCorrectIds.includes(alternative.id), score: preservedCorrectIds.includes(alternative.id) ? points : 0 })),
      correctAlternativeId: (existing?.type ?? row.type) === "selection" ? preservedCorrectIds[0] ?? null : null,
      correctAlternativeIds: (existing?.type ?? row.type) === "multiple" ? preservedCorrectIds : [],
      placeholder: null,
      active: true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      updatedBy: "system:seed"
    };
  });
}

async function ensureNpdApproachCourse(botId: string | null, guildId: string) {
  const { courses, courseExamSettings, courseExamQuestions } = await getMongoCollections();
  const now = new Date();
  const existing = await courses.findOne({
    ...scope(botId, guildId),
    $or: [
      { code: "npd_abordagem" },
      { code: "curso-abordagem-npd" },
      { code: "npd-abordagem" },
      { name: "CURSO DE ABORDAGEM - NPD" },
      { name: "Curso de Abordagem - NPD" }
    ]
  });
  const courseId = existing?._id ?? randomUUID();
  const description = "Esta prova foi desenvolvida com o objetivo de capacitar e instruir todos os policiais do North Police Department a realizar a instrução padrão e com excelência, para que nosso batalhão mantenha o alto padrão no nosso procedimento de abordagem.\n\nApós a aprovação no curso, será esperado e cobrado a execução plena e adequada de todos os conteúdos abordados nesta apostila. Uma vez que o curso foi registrado na planilha, falhas no procedimento estarão sujeitas a punições, além da reciclagem do respectivo curso.";

  if (!existing) {
    await courses.insertOne({
      _id: courseId,
      botId,
      guildId,
      name: "CURSO DE ABORDAGEM - NPD",
      code: "npd_abordagem",
      description,
      emoji: null,
      color: "#7c3aed",
      bannerUrl: null,
      proofBannerUrl: null,
      footerImageUrl: null,
      thumbnailUrl: null,
      imagePosition: "top",
      publishText: null,
      proofInstructionText: null,
      startedText: null,
      cancelledText: null,
      buttonLabels: {
        cancel: "Cancelar Curso",
        enter: "Entrar no Curso",
        leave: "Sair do Curso",
        start: "Realizar Prova"
      },
      instructorUserIds: [],
      instructorRoleIds: [],
      allowGeneralInstructorRoles: true,
      publishChannelId: null,
      maxStudents: 30,
      location: null,
      defaultSchedule: null,
      active: false,
      createdBy: "system:seed",
      updatedBy: "system:seed",
      createdAt: now,
      updatedAt: now
    });
  } else if (
    existing.code !== "npd_abordagem"
    || existing.buttonLabels?.start !== "Realizar Prova"
    || !existing.description
    || existing.updatedBy === "system:seed"
  ) {
    const seedOwned = existing.updatedBy === "system:seed";
    await courses.updateOne(
      { _id: existing._id, ...scope(botId, guildId) },
      {
        $set: {
          code: "npd_abordagem",
          ...(seedOwned ? {
            color: "#FFD500",
            description,
            name: "CURSO DE ABORDAGEM - NPD",
            updatedBy: "system:seed"
          } : {
            description: existing.description || description
          }),
          buttonLabels: {
            ...existing.buttonLabels,
            start: "Realizar Prova"
          },
          updatedAt: now
        }
      }
    );
  }

  await courseExamSettings.updateOne(
    { ...scope(botId, guildId), courseId },
    {
      $setOnInsert: {
        _id: randomUUID(),
        botId,
        guildId,
        courseId,
        enabled: false,
        minScore: 70,
        maxTimeMinutes: null,
        correctionChannelId: null,
        resultChannelId: null,
        temporaryCategoryId: null,
        logChannelId: null,
        deleteWrittenAnswers: false,
        allowCurrentQuestionReview: false,
        initialMessage: "Bem-vindo à prova do CURSO DE ABORDAGEM - NPD. Leia cada pergunta com atenção.",
        finalMessage: "Tem certeza de que deseja finalizar esta prova? Depois da confirmação, as respostas não poderão ser alteradas.",
        approvalMessage: "Você foi aprovado no CURSO DE ABORDAGEM - NPD.",
        rejectionMessage: "Sua prova foi concluída, mas a nota mínima necessária não foi atingida.",
        manualQuestionMaxScore: 0,
        manualApproval: true,
        automaticApproval: false,
        releaseMode: "immediate",
        releaseAt: null,
        attemptLimit: 1,
        allowAnswerChange: false,
        showAnswersAfterExam: false,
        version: 1,
        examKey: "npd-abordagem-v1",
        externalLinkEnabled: false,
        externalLinkText: "Acessar material da prova",
        externalLinkUrl: null,
        externalLinkDescription: null,
        externalLinkEmoji: null,
        updatedAt: now,
        updatedBy: "system:seed"
      }
    },
    { upsert: true }
  );

  const existingQuestions = await courseExamQuestions.find({ ...scope(botId, guildId), courseId }).toArray();
  const existingByNumber = new Map(existingQuestions.map((question) => [question.questionNumber ?? question.order + 1, question]));
  const existingByPrompt = new Map(existingQuestions.map((question) => [normalizeCourseSeedText(question.prompt), question]));
  const nextQuestions = npdApproachQuestions(courseId, botId, guildId, now, existingByNumber, existingByPrompt);

  for (const question of nextQuestions) {
    const existingQuestion = existingByNumber.get(question.questionNumber ?? question.order + 1) ?? existingByPrompt.get(normalizeCourseSeedText(question.prompt));
    if (!existingQuestion) await courseExamQuestions.insertOne(question);
    else if (existingQuestion.updatedBy === "system:seed") {
      await courseExamQuestions.updateOne(
        { _id: existingQuestion._id, ...scope(botId, guildId), courseId },
        {
          $set: {
            active: question.active,
            alternatives: question.alternatives,
            correctAlternativeId: question.correctAlternativeId,
            correctAlternativeIds: question.correctAlternativeIds,
            description: question.description,
            order: question.order,
            placeholder: question.placeholder,
            points: question.points,
            prompt: question.prompt,
            questionNumber: question.questionNumber,
            title: question.title,
            type: question.type,
            updatedAt: now,
            updatedBy: "system:seed"
          }
        }
      );
    }
  }
}

function npdApproachQuestions(
  courseId: string,
  botId: string | null,
  guildId: string,
  now: Date,
  existingByNumber: Map<number, MongoCourseExamQuestion>,
  existingByPrompt: Map<string, MongoCourseExamQuestion>
) {
  const rows: Array<{ prompt: string; instruction: string; type: "selection" | "multiple"; alternatives: string[] }> = [
    { prompt: "Quais requisitos para iniciar-se uma abordagem de código 1?", instruction: "Assinale as alternativas corretas.", type: "multiple", alternatives: ["Vantagem numérica", "Apontar arma na cara do indivíduo para manter nossa segurança", "Vantagem tática", "Algemar o indivíduo", "Revistar o indivíduo"] },
    { prompt: "O que deve-se verificar em uma abordagem de código 1 (baixa intensidade)?", instruction: "Assinale as alternativas corretas.", type: "multiple", alternatives: ["Solicitar documentos", "Verificar multas pendentes", "Algemar e revistar", "Verificar situação do veículo (avariado ou não)", "Verificar se o passaporte está em dia"] },
    { prompt: "Selecione procedimentos que você faria em uma abordagem de código 2 próximo à uma denúncia de Venda de Drogas (média intensidade).", instruction: "Assinale as alternativas corretas.", type: "multiple", alternatives: ["Observar comportamento do indivíduo perante a abordagem", "Realizar o teste de pólvora", "Algemar (por ser suspeito)", "Realizar o teste de entorpecentes", "Verificação de documentos (identidade e passaporte)"] },
    { prompt: "Selecione procedimentos que você faria em uma abordagem de código 3 em um Roubo de Caixa Eletrônico (alta intensidade).", instruction: "Assinale as alternativas corretas.", type: "multiple", alternatives: ["Revistar o indivíduo", "Usar força letal (armas)", "Liberar o indivíduo", "Algemar o indivíduo"] },
    { prompt: "Quais tipos de comportamentos devem ser aderidos pelo oficial durante uma abordagem de COD.1?", instruction: "Assinale as alternativas corretas.", type: "multiple", alternatives: ["Apresentação (QRA)", "Revistar o veículo", "Contextualização (motivo da abordagem)", "Averiguação (verificação de documentos)", "Advertência — se houver (multa, advertência verbal, entre outros)"] },
    { prompt: "Durante uma abordagem de código 3, onde dois indivíduos foram vistos armados e já estão algemados, vários veículos/pessoas começam a se aproximar. O que você faria nessa situação?", instruction: "Assinale as alternativas corretas.", type: "multiple", alternatives: ["Solicitar que saiam do perímetro da abordagem", "Prisão por desobediência em caso de insistência de permanência no local", "Uso progressivo da força", "Abriria fogo contra os mesmos", "Solicitar apoio adicional na abordagem"] },
    { prompt: "Durante um cód. 5 no aeroporto de Trevor, três indivíduos fortemente armados foram vistos disparando contra cidadãos de bem. O que você faria nessa situação?", instruction: "Assinale as alternativas corretas.", type: "multiple", alternatives: ["Solicitaria apoio", "Tentaria, sozinho, abater os mesmos", "Informaria na rádio POLICIANPD as descrições de vestimentas", "Informaria na rádio POLICIANPD as descrições dos veículos", "Realizaria uma abordagem de código 3"] },
    { prompt: "Você avistou 4 indivíduos efetuando disparos em uma QRU de Contrato Ilegal e, após notar a chegada da polícia, os mesmos entraram em seus veículos e aplicaram fuga de abordagem. Qual o procedimento correto a ser seguido?", instruction: "Assinale a alternativa correta.", type: "selection", alternatives: ["Solicitar apoio e abater os quatro indivíduos", "Solicitar apoio e iniciar acompanhamento"] },
    { prompt: "Em quais momentos podemos realizar a revista direta nos indivíduos/veículos?", instruction: "Assinale a alternativa incorreta.", type: "selection", alternatives: ["Flagrante de denúncia", "Uso de máscaras", "Uso de colete militar", "Uniforme combinado", "Veículo irregular", "Após ganhar uma ação fechada (Ammunation, Lojinha, Joalheria etc.)"] },
    { prompt: "Qual é o procedimento de revista do sexo oposto?", instruction: "Assinale as alternativas corretas. A alternativa E está incompleta e deve ser completada por um administrador antes da publicação.", type: "multiple", alternatives: ["Feita por um(a) oficial do mesmo sexo", "Pode-se usar a metodologia da “caixa” caso não haja oficiais do mesmo sexo", "Pode revistar diretamente se não colaborar", "Chamar o PC. Moretta para realizar a revista independente do sexo", "Pode-se usar a metodologia da “caixa” se o indivíduo permitir, mesmo com um oficial do sexo oposto..."] }
  ];

  return rows.map((row, index) => {
    const optionPrefix = `q${String(index + 1).padStart(2, "0")}_option_`;
    const alternatives = row.alternatives.map((text, optionIndex) => ({
      id: `${optionPrefix}${String(optionIndex + 1).padStart(2, "0")}`,
      text,
      value: `${optionPrefix}${String(optionIndex + 1).padStart(2, "0")}`,
      score: 0,
      isCorrect: false,
      order: optionIndex
    }));
    const existing = existingByNumber.get(index + 1) ?? existingByPrompt.get(normalizeCourseSeedText(row.prompt));
    const preservedCorrectIds = preserveCourseSeedCorrectIds(existing, alternatives);
    const points = existing?.points && existing.points > 0 ? existing.points : 10;
    return {
      _id: existing?._id ?? randomUUID(),
      botId,
      guildId,
      courseId,
      order: index,
      questionNumber: index + 1,
      type: existing?.type ?? row.type,
      prompt: row.prompt,
      title: row.prompt,
      description: row.instruction,
      points,
      alternatives: alternatives.map((alternative) => ({ ...alternative, isCorrect: preservedCorrectIds.includes(alternative.id), score: preservedCorrectIds.includes(alternative.id) ? points : 0 })),
      correctAlternativeId: (existing?.type ?? row.type) === "selection" ? preservedCorrectIds[0] ?? null : null,
      correctAlternativeIds: (existing?.type ?? row.type) === "multiple" ? preservedCorrectIds : [],
      placeholder: null,
      active: true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      updatedBy: "system:seed"
    };
  });
}

function preserveCourseSeedCorrectIds(
  existing: MongoCourseExamQuestion | undefined,
  nextAlternatives: Array<{ id: string; text: string; order: number }>
) {
  if (!existing) return [];
  const existingCorrectIds = [
    ...(existing.correctAlternativeIds ?? []),
    ...(existing.correctAlternativeId ? [existing.correctAlternativeId] : []),
    ...existing.alternatives.filter((alternative) => alternative.isCorrect).map((alternative) => alternative.id)
  ].filter(Boolean);
  const byOldId = new Map(existing.alternatives.map((alternative, index) => [alternative.id, index]));
  const byText = new Map(existing.alternatives.map((alternative, index) => [normalizeCourseSeedText(alternative.text), index]));
  return [...new Set(existingCorrectIds.flatMap((correctId) => {
    const oldIndex = byOldId.get(correctId);
    if (oldIndex != null && nextAlternatives[oldIndex]) return [nextAlternatives[oldIndex].id];
    const existingAlternative = existing.alternatives.find((alternative) => alternative.id === correctId);
    const textIndex = existingAlternative ? byText.get(normalizeCourseSeedText(existingAlternative.text)) : undefined;
    if (textIndex != null && nextAlternatives[textIndex]) return [nextAlternatives[textIndex].id];
    return [];
  }))];
}

function normalizeCourseSeedText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export async function getCourseSettings(botId: string | null, guildId: string) {
  const { courseSettings } = await getMongoCollections();
  const existing = await courseSettings.findOne(scope(botId, guildId));
  if (existing) {
    if (existing.defaultExpirationHours == null) {
      existing.defaultExpirationHours = DEFAULT_COURSE_CHANNEL_EXPIRATION_HOURS;
      await courseSettings.updateOne(
        { _id: existing._id, ...scope(botId, guildId), defaultExpirationHours: null },
        { $set: { defaultExpirationHours: DEFAULT_COURSE_CHANNEL_EXPIRATION_HOURS } }
      );
    }
    return mapSettings(existing);
  }

  const now = new Date();
  const doc: MongoCourseSettings = {
    _id: randomUUID(),
    botId,
    guildId,
    publishChannelId: null,
    scheduleChannelId: null,
    scheduleLogChannelId: null,
    proofLogChannelId: null,
    resultChannelId: null,
    evaluationChannelId: null,
    reportChannelId: null,
    logChannelId: null,
    adminLogChannelId: null,
    temporaryCategoryId: null,
    tempProofCategoryId: null,
    evaluatorMentionRoleId: null,
    resultMentionRoleId: null,
    adminUserIds: [],
    adminRoleIds: [],
    managerUserIds: [],
    managerRoleIds: [],
    generalInstructorRoleIds: [],
    globalInstructorUserIds: [],
    globalInstructorRoleIds: [],
    evaluatorUserIds: [],
    evaluatorRoleIds: [],
    configUserIds: [],
    configRoleIds: [],
    permissionMatrix: {},
    images: [],
    defaultExpirationHours: DEFAULT_COURSE_CHANNEL_EXPIRATION_HOURS,
    noPermissionMessage: "Você não possui permissão para usar este sistema.",
    cancelledMessage: "Curso cancelado.",
    startedMessage: "O curso foi iniciado. Novas entradas estão bloqueadas.",
    globalBannerUrl: null,
    reportImageUrl: null,
    panelMessageId: null,
    lastPanelRequestedAt: null,
    buttonEmojis: {
      cancel: fixedSystemEmojiText("exclamacao"),
      enter: fixedSystemEmojiText("visto"),
      leave: fixedSystemEmojiText("porta"),
      start: fixedSystemEmojiText("acessar")
    },
    updatedAt: now,
    updatedBy: null
  };
  await courseSettings.insertOne(doc);
  return mapSettings(doc);
}

export async function saveCourseSettings(botId: string | null, guildId: string, input: CourseSettingsUpdate, actorId: string | null) {
  const { courseSettings } = await getMongoCollections();
  const now = new Date();
  await courseSettings.updateOne(scope(botId, guildId), {
    $set: {
      ...cleanSettings(input),
      updatedAt: now,
      updatedBy: actorId
    },
    $setOnInsert: {
      _id: randomUUID(),
      botId,
      guildId
    }
  }, { upsert: true });
  await logCourseAction(botId, guildId, "course.settings_saved", actorId, null, null, input);
  emitRealtime("courses:settings", { botId, guildId });
  return getCourseSettings(botId, guildId);
}

export async function requestCoursePanelPublish(botId: string, guildId: string, actorId: string | null) {
  const settings = await getCourseSettings(botId, guildId);
  if (!settings.publishChannelId) throw new Error("Configure o canal de publicação dos cursos.");

  const { courseSettings } = await getMongoCollections();
  const requestedAt = new Date();
  await courseSettings.updateOne(scope(botId, guildId), {
    $set: {
      lastPanelRequestedAt: requestedAt,
      updatedAt: requestedAt,
      updatedBy: actorId
    },
    $setOnInsert: {
      _id: randomUUID(),
      botId,
      guildId
    }
  }, { upsert: true });

  const nextSettings = await getCourseSettings(botId, guildId);
  emitRealtime("courses:panel_publish", { botId, guildId, settings: nextSettings });
  await logCourseAction(botId, guildId, "course.panel_publish_requested", actorId, null, null, { channelId: nextSettings.publishChannelId });
  return nextSettings;
}

export async function updateCoursePanelMessage(botId: string | null, guildId: string, messageId: string | null) {
  const { courseSettings } = await getMongoCollections();
  await courseSettings.updateOne(scope(botId, guildId), { $set: { panelMessageId: messageId, updatedAt: new Date() } });
  return getCourseSettings(botId, guildId);
}

export async function createCourse(botId: string | null, guildId: string, input: Partial<CourseDto> & { name: string }, actorId: string | null) {
  const { courses } = await getMongoCollections();
  const now = new Date();
  const doc: MongoCourse = {
    _id: randomUUID(),
    botId,
    guildId,
    name: input.name.trim(),
    code: input.code?.trim() || null,
    description: input.description?.trim() || null,
    emoji: input.emoji?.trim() || null,
    color: input.color || "#2563eb",
    bannerUrl: input.bannerUrl || null,
    proofBannerUrl: input.proofBannerUrl || null,
    footerImageUrl: input.footerImageUrl || null,
    thumbnailUrl: input.thumbnailUrl || null,
    imagePosition: input.imagePosition ?? "top",
    publishText: input.publishText || null,
    proofInstructionText: input.proofInstructionText || null,
    startedText: input.startedText || null,
    cancelledText: input.cancelledText || null,
    buttonLabels: {
      cancel: input.buttonLabels?.cancel || "Cancelar Curso",
      enter: input.buttonLabels?.enter || "Entrar no Curso",
      leave: input.buttonLabels?.leave || "Sair do Curso",
      start: input.buttonLabels?.start || "Iniciar Curso"
    },
    instructorUserIds: input.instructorUserIds ?? [],
    instructorRoleIds: input.instructorRoleIds ?? [],
    allowGeneralInstructorRoles: input.allowGeneralInstructorRoles ?? true,
    publishChannelId: null,
    maxStudents: Math.max(1, Number(input.maxStudents ?? 30) || 30),
    location: input.location || null,
    defaultSchedule: input.defaultSchedule || null,
    active: input.active ?? true,
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: now,
    updatedAt: now
  };
  await courses.insertOne(doc);
  await logCourseAction(botId, guildId, "course.created", actorId, doc._id, null, { name: doc.name });
  emitRealtime("courses:changed", { botId, guildId, courseId: doc._id });
  return mapCourse(doc);
}

export async function updateCourse(botId: string | null, guildId: string, courseId: string, input: Partial<CourseDto>, actorId: string | null) {
  const { courses } = await getMongoCollections();
  await courses.updateOne({ _id: courseId, ...scope(botId, guildId) }, {
    $set: {
      ...cleanCourse(input),
      updatedBy: actorId,
      updatedAt: new Date()
    }
  });
  const course = await courses.findOne({ _id: courseId, ...scope(botId, guildId) });
  if (!course) return null;
  await logCourseAction(botId, guildId, "course.updated", actorId, courseId, null, input);
  emitRealtime("courses:changed", { botId, guildId, courseId });
  return mapCourse(course);
}

export async function deleteCourse(botId: string | null, guildId: string, courseId: string, actorId: string | null) {
  const { courses } = await getMongoCollections();
  const course = await courses.findOneAndDelete({ _id: courseId, ...scope(botId, guildId) });
  if (!course) return null;
  await logCourseAction(botId, guildId, "course.deleted", actorId, courseId, null, { name: course.name });
  emitRealtime("courses:changed", { botId, guildId, courseId });
  return mapCourse(course);
}

export async function getManageableCourses(botId: string | null, guildId: string, userId: string, roleIds: string[], isAdministrator = false) {
  const settings = await getCourseSettings(botId, guildId);
  const { courses } = await getMongoCollections();
  const all = await courses.find({ ...scope(botId, guildId), active: true }).sort({ name: 1 }).toArray();

  if (isAdministrator || isCourseManager(settings, userId, roleIds)) {
    return all.map(mapCourse);
  }

  return all
    .filter((course) => course.instructorUserIds.includes(userId)
      || course.instructorRoleIds.some((roleId) => roleIds.includes(roleId))
      || (course.allowGeneralInstructorRoles !== false && (settings.generalInstructorRoleIds ?? []).some((roleId) => roleIds.includes(roleId))))
    .map(mapCourse);
}

export async function getCourse(botId: string | null, guildId: string, courseId: string) {
  const { courses } = await getMongoCollections();
  const course = await courses.findOne({ _id: courseId, ...scope(botId, guildId) });
  return course ? mapCourse(course) : null;
}

export async function ensureDefaultCourseDepartments(botId: string | null, guildId: string) {
  const { courseDepartments } = await getMongoCollections();
  const now = new Date();
  await Promise.all(DEFAULT_COURSE_DEPARTMENTS.map(async (name) => {
    const normalizedName = normalizeCourseDepartmentName(name);
    await courseDepartments.updateOne(
      { ...scope(botId, guildId), normalizedName },
      {
        $setOnInsert: {
          _id: randomUUID(),
          botId,
          guildId,
          name,
          normalizedName,
          active: true,
          createdBy: null,
          createdAt: now,
          updatedAt: now
        }
      },
      { upsert: true }
    );
  }));
}

export async function listCourseDepartments(botId: string | null, guildId: string, activeOnly = false) {
  const { courseDepartments } = await getMongoCollections();
  await ensureDefaultCourseDepartments(botId, guildId);
  const query = { ...scope(botId, guildId), ...(activeOnly ? { active: true } : {}) };
  const departments = await courseDepartments.find(query).sort({ active: -1, name: 1 }).toArray();
  return departments.map(mapCourseDepartment);
}

export async function getCourseDepartment(botId: string | null, guildId: string, departmentId: string) {
  const { courseDepartments } = await getMongoCollections();
  await ensureDefaultCourseDepartments(botId, guildId);
  const department = await courseDepartments.findOne({ _id: departmentId, ...scope(botId, guildId) });
  return department ? mapCourseDepartment(department) : null;
}

export async function getActiveCourseDepartment(botId: string | null, guildId: string, departmentId: string) {
  const { courseDepartments } = await getMongoCollections();
  await ensureDefaultCourseDepartments(botId, guildId);
  const department = await courseDepartments.findOne({ _id: departmentId, ...scope(botId, guildId) });
  if (!department) throw new CourseDepartmentError("not_found", "DP nao encontrada.");
  if (!department.active) throw new CourseDepartmentError("inactive", "DP desativada.");
  return mapCourseDepartment(department);
}

export async function createCourseDepartment(botId: string | null, guildId: string, input: { name: string }, actorId: string | null) {
  const { courseDepartments } = await getMongoCollections();
  await ensureDefaultCourseDepartments(botId, guildId);
  const name = sanitizeCourseDepartmentName(input.name);
  const normalizedName = normalizeCourseDepartmentName(name);
  if (!normalizedName) throw new CourseDepartmentError("invalid_name", "Nome de DP invalido.");
  const duplicate = await courseDepartments.findOne({ ...scope(botId, guildId), normalizedName, active: true });
  if (duplicate) throw new CourseDepartmentError("duplicate", "Ja existe uma DP ativa com esse nome.");
  const now = new Date();
  const doc: MongoCourseDepartment = {
    _id: randomUUID(),
    active: true,
    botId,
    createdAt: now,
    createdBy: actorId,
    guildId,
    name,
    normalizedName,
    updatedAt: now,
    updatedBy: actorId
  };
  try {
    await courseDepartments.insertOne(doc);
  } catch (error) {
    if (isDuplicateKeyError(error)) throw new CourseDepartmentError("duplicate", "Ja existe uma DP ativa com esse nome.");
    throw error;
  }
  await logCourseAction(botId, guildId, "course.department_created", actorId, null, null, { departmentId: doc._id, name });
  return mapCourseDepartment(doc);
}

export async function updateCourseDepartment(botId: string | null, guildId: string, departmentId: string, input: { active?: boolean; name?: string }, actorId: string | null) {
  const { courseDepartments } = await getMongoCollections();
  await ensureDefaultCourseDepartments(botId, guildId);
  const current = await courseDepartments.findOne({ _id: departmentId, ...scope(botId, guildId) });
  if (!current) throw new CourseDepartmentError("not_found", "DP nao encontrada.");
  const patch: Partial<MongoCourseDepartment> = { updatedAt: new Date(), updatedBy: actorId };
  if (typeof input.name === "string") {
    const name = sanitizeCourseDepartmentName(input.name);
    const normalizedName = normalizeCourseDepartmentName(name);
    if (!normalizedName) throw new CourseDepartmentError("invalid_name", "Nome de DP invalido.");
    const duplicate = await courseDepartments.findOne({ _id: { $ne: departmentId }, ...scope(botId, guildId), normalizedName, active: true });
    if (duplicate && input.active !== false) throw new CourseDepartmentError("duplicate", "Ja existe uma DP ativa com esse nome.");
    patch.name = name;
    patch.normalizedName = normalizedName;
  }
  if (typeof input.active === "boolean") {
    if (input.active) {
      const normalizedName = patch.normalizedName ?? current.normalizedName;
      const duplicate = await courseDepartments.findOne({ _id: { $ne: departmentId }, ...scope(botId, guildId), normalizedName, active: true });
      if (duplicate) throw new CourseDepartmentError("duplicate", "Ja existe uma DP ativa com esse nome.");
    }
    patch.active = input.active;
  }
  try {
    await courseDepartments.updateOne({ _id: departmentId, ...scope(botId, guildId) }, { $set: patch });
  } catch (error) {
    if (isDuplicateKeyError(error)) throw new CourseDepartmentError("duplicate", "Ja existe uma DP ativa com esse nome.");
    throw error;
  }
  const updated = await courseDepartments.findOne({ _id: departmentId, ...scope(botId, guildId) });
  await logCourseAction(botId, guildId, "course.department_updated", actorId, null, null, { active: patch.active, departmentId, name: patch.name });
  return mapCourseDepartment(updated ?? { ...current, ...patch });
}

export async function deleteCourseDepartment(botId: string | null, guildId: string, departmentId: string, actorId: string | null) {
  const { courseDepartments, coursePublications } = await getMongoCollections();
  await ensureDefaultCourseDepartments(botId, guildId);
  const current = await courseDepartments.findOne({ _id: departmentId, ...scope(botId, guildId) });
  if (!current) throw new CourseDepartmentError("not_found", "DP nao encontrada.");
  const linkedPublications = await coursePublications.countDocuments({ ...scope(botId, guildId), dpId: departmentId });
  if (linkedPublications > 0) {
    const department = await updateCourseDepartment(botId, guildId, departmentId, { active: false }, actorId);
    await logCourseAction(botId, guildId, "course.department_delete_blocked_deactivated", actorId, null, null, { departmentId, linkedPublications });
    return { deleted: false, department };
  }
  await courseDepartments.deleteOne({ _id: departmentId, ...scope(botId, guildId) });
  await logCourseAction(botId, guildId, "course.department_deleted", actorId, null, null, { departmentId, name: current.name });
  return { deleted: true, department: mapCourseDepartment(current) };
}

export async function createCoursePublication(botId: string | null, guildId: string, input: {
  capacity: number;
  channelId: string;
  courseId: string;
  discordEventType?: "EXTERNAL" | "VOICE" | "STAGE" | null;
  instructorId: string;
  location: string;
  legacyLocation?: string | null;
  dpId?: string | null;
  dpNameSnapshot?: string | null;
  notes?: string | null;
  scheduledFor: string;
  scheduledStartAt?: string | null;
  scheduledEndAt?: string | null;
  voiceChannelId?: string | null;
}) {
  const { coursePublications } = await getMongoCollections();
  const now = new Date();
  const existingOpen = await coursePublications.findOne({ ...scope(botId, guildId), courseId: input.courseId, status: "open" });
  if (existingOpen) {
    await coursePublications.updateOne({ _id: existingOpen._id, ...scope(botId, guildId) }, {
      $set: {
        capacity: Math.max(1, input.capacity),
        channelId: input.channelId,
        discordEventType: input.discordEventType ?? existingOpen.discordEventType ?? "EXTERNAL",
        instructorId: input.instructorId,
        location: input.location,
        legacyLocation: input.legacyLocation ?? existingOpen.legacyLocation ?? null,
        dpId: input.dpId ?? existingOpen.dpId ?? null,
        dpNameSnapshot: input.dpNameSnapshot ?? existingOpen.dpNameSnapshot ?? null,
        notes: input.notes || null,
        scheduledFor: input.scheduledFor,
        scheduledStartAt: parseOptionalDate(input.scheduledStartAt) ?? existingOpen.scheduledStartAt ?? null,
        scheduledEndAt: parseOptionalDate(input.scheduledEndAt) ?? existingOpen.scheduledEndAt ?? null,
        voiceChannelId: input.voiceChannelId || null,
        updatedAt: now
      }
    });
    const updated = await coursePublications.findOne({ _id: existingOpen._id, ...scope(botId, guildId) });
    await logCourseAction(botId, guildId, "course.publication_updated", input.instructorId, input.courseId, existingOpen._id, input);
    emitRealtime("courses:publication", { botId, guildId, publicationId: existingOpen._id });
    return mapPublication(updated ?? existingOpen);
  }
  const doc: MongoCoursePublication = {
    _id: randomUUID(),
    botId,
    guildId,
    courseId: input.courseId,
    channelId: input.channelId,
    messageId: null,
    discordEventId: null,
    discordEventUrl: null,
    discordEventType: input.discordEventType ?? "EXTERNAL",
    voiceChannelId: input.voiceChannelId || null,
    scheduledStartAt: parseOptionalDate(input.scheduledStartAt),
    scheduledEndAt: parseOptionalDate(input.scheduledEndAt),
    lastSyncAt: null,
    syncError: null,
    instructorId: input.instructorId,
    location: input.location,
    legacyLocation: input.legacyLocation ?? null,
    dpId: input.dpId ?? null,
    dpNameSnapshot: input.dpNameSnapshot ?? null,
    scheduledFor: input.scheduledFor,
    capacity: Math.max(1, input.capacity),
    students: [],
    notes: input.notes || null,
    status: "open",
    cancelledBy: null,
    cancelledAt: null,
    startedBy: null,
    startedAt: null,
    proofStartedBy: null,
    proofStartedAt: null,
    finishedBy: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now
  };
  await coursePublications.insertOne(doc);
  await logCourseAction(botId, guildId, "course.published", input.instructorId, input.courseId, doc._id, input);
  emitRealtime("courses:publication", { botId, guildId, publicationId: doc._id });
  return mapPublication(doc);
}

export async function updateCoursePublicationEvent(botId: string | null, guildId: string, publicationId: string, input: {
  discordEventId?: string | null;
  discordEventUrl?: string | null;
  syncError?: string | null;
}) {
  const { coursePublications } = await getMongoCollections();
  const patch: Record<string, unknown> = {
    lastSyncAt: new Date(),
    updatedAt: new Date()
  };
  if ("discordEventId" in input) patch.discordEventId = input.discordEventId ?? null;
  if ("discordEventUrl" in input) patch.discordEventUrl = input.discordEventUrl ?? null;
  if ("syncError" in input) patch.syncError = input.syncError ?? null;
  await coursePublications.updateOne({ _id: publicationId, ...scope(botId, guildId) }, {
    $set: patch
  });
  const publication = await coursePublications.findOne({ _id: publicationId, ...scope(botId, guildId) });
  return publication ? mapPublication(publication) : null;
}

export async function updateCoursePublicationMessage(botId: string | null, guildId: string, publicationId: string, messageId: string | null) {
  const { coursePublications } = await getMongoCollections();
  await coursePublications.updateOne({ _id: publicationId, ...scope(botId, guildId) }, { $set: { messageId, updatedAt: new Date() } });
  const publication = await coursePublications.findOne({ _id: publicationId, ...scope(botId, guildId) });
  return publication ? mapPublication(publication) : null;
}

export async function getCoursePublication(botId: string | null, guildId: string, publicationId: string) {
  const { coursePublications } = await getMongoCollections();
  const publication = await coursePublications.findOne({ _id: publicationId, ...scope(botId, guildId) });
  return publication ? mapPublication(publication) : null;
}

export async function listCoursePublications(botId: string | null, guildId: string, status?: MongoCoursePublication["status"] | null) {
  const { coursePublications } = await getMongoCollections();
  const query = {
    ...scope(botId, guildId),
    ...(status ? { status } : {})
  };
  const publications = await coursePublications.find(query).sort({ createdAt: -1 }).limit(50).toArray();
  return publications.map(mapPublication);
}

export async function getCoursePublicationEnrollments(botId: string | null, guildId: string, publicationId: string) {
  const { courseEnrollments } = await getMongoCollections();
  const enrollments = await courseEnrollments.find({ ...scope(botId, guildId), publicationId, enrollmentStatus: "ENROLLED" })
    .sort({ enrolledAt: 1 }).toArray();
  return enrollments.map(mapEnrollment);
}

export async function reserveCourseExamStart(botId: string | null, guildId: string, publicationId: string, studentId: string) {
  const { coursePublications, courseEnrollments, courseExamSettings, courseExamQuestions } = await getMongoCollections();
  const publication = await coursePublications.findOne({ _id: publicationId, ...scope(botId, guildId) });
  if (!publication) return { error: "not_found" as const };
  if (!publication.students.includes(studentId)) return { error: "not_enrolled" as const };
  if (publication.status === "cancelled") return { error: "cancelled" as const };
  if (publication.status === "closed" || publication.status === "finished") return { error: "finished" as const };
  if (publication.status !== "started" && publication.status !== "proof") return { error: "not_started" as const };
  const exam = await courseExamSettings.findOne({ ...scope(botId, guildId), courseId: publication.courseId });
  if (!exam) return { error: "exam_missing" as const };
  if (!exam.enabled) return { error: "exam_disabled" as const };
  if (!await courseExamQuestions.countDocuments({ ...scope(botId, guildId), courseId: publication.courseId, active: true })) {
    return { error: "exam_missing" as const };
  }
  const enrollment = await courseEnrollments.findOne({ ...scope(botId, guildId), publicationId, studentId, enrollmentStatus: "ENROLLED" });
  if (!enrollment) return { error: "not_enrolled" as const };
  if (["COMPLETED", "APPROVED", "FAILED"].includes(enrollment.examStatus)) return { error: "completed" as const, enrollment: mapEnrollment(enrollment) };
  const staleStarting = enrollment.examStatus === "STARTING" && Date.now() - enrollment.updatedAt.getTime() >= 5 * 60 * 1000;
  if (enrollment.examStatus === "IN_PROGRESS" || (enrollment.examStatus === "STARTING" && !staleStarting)) {
    return { error: "in_progress" as const, enrollment: mapEnrollment(enrollment) };
  }
  const now = new Date();
  const reserved = await courseEnrollments.updateOne(
    { _id: enrollment._id, ...scope(botId, guildId), examStatus: { $in: ["AVAILABLE", "NOT_AVAILABLE", "EXPIRED", "STARTING"] } },
    { $set: { examId: exam._id, examStatus: "STARTING", examChannelId: null, examStartedAt: now, updatedAt: now } }
  );
  if (reserved.modifiedCount === 0) {
    const current = await courseEnrollments.findOne({ _id: enrollment._id, ...scope(botId, guildId) });
    return { error: "in_progress" as const, enrollment: current ? mapEnrollment(current) : undefined };
  }
  const current = await courseEnrollments.findOne({ _id: enrollment._id, ...scope(botId, guildId) });
  emitRealtime("courses:publication", { botId, guildId, publicationId });
  return { enrollment: mapEnrollment(current ?? { ...enrollment, examId: exam._id, examStatus: "STARTING", examChannelId: null, examStartedAt: now, updatedAt: now }) };
}

export async function releaseCourseExamStart(botId: string | null, guildId: string, publicationId: string, studentId: string) {
  const { courseEnrollments } = await getMongoCollections();
  await courseEnrollments.updateOne(
    { ...scope(botId, guildId), publicationId, studentId, examStatus: "STARTING" },
    { $set: { examStatus: "AVAILABLE", examChannelId: null, updatedAt: new Date() } }
  );
  emitRealtime("courses:publication", { botId, guildId, publicationId });
}

export async function joinCoursePublication(botId: string | null, guildId: string, publicationId: string, input: { userId: string; studentName: string }) {
  const { coursePublications, courseEnrollments } = await getMongoCollections();
  const userId = input.userId;
  const publication = await coursePublications.findOne({ _id: publicationId, ...scope(botId, guildId) });
  if (!publication) return { error: "not_found" as const };
  if (publication.status === "started") return { error: "started" as const, publication: mapPublication(publication) };
  if (publication.status !== "open") return { error: "closed" as const, publication: mapPublication(publication) };
  if (publication.students.includes(userId)) return { error: "already" as const, publication: mapPublication(publication) };
  if (publication.students.length >= publication.capacity) return { error: "full" as const, publication: mapPublication(publication) };
  await coursePublications.updateOne({ _id: publicationId, ...scope(botId, guildId) }, { $addToSet: { students: userId }, $set: { updatedAt: new Date() } });
  const now = new Date();
  try {
    await courseEnrollments.updateOne(
      { ...scope(botId, guildId), publicationId, studentId: userId },
      {
        $set: {
          courseId: publication.courseId,
          studentName: input.studentName.trim().slice(0, 100) || userId,
          publicationChannelId: publication.channelId,
          enrollmentStatus: "ENROLLED",
          examStatus: "NOT_AVAILABLE",
          updatedAt: now
        },
        $setOnInsert: {
          _id: randomUUID(), botId, guildId, publicationId, studentId: userId, enrolledAt: now,
          examId: null, attemptId: null, examChannelId: null, score: null, correctAnswers: null,
          result: null, completedAt: null, correctedBy: null, transcriptId: null
        }
      },
      { upsert: true }
    );
  } catch (error) {
    await coursePublications.updateOne({ _id: publicationId, ...scope(botId, guildId) }, { $pull: { students: userId }, $set: { updatedAt: new Date() } }).catch(() => null);
    throw error;
  }
  const updated = await coursePublications.findOne({ _id: publicationId, ...scope(botId, guildId) });
  await logCourseAction(botId, guildId, "course.student_joined", userId, publication.courseId, publicationId, { userId });
  emitRealtime("courses:publication", { botId, guildId, publicationId });
  return { publication: mapPublication(updated ?? publication) };
}

export async function leaveCoursePublication(botId: string | null, guildId: string, publicationId: string, userId: string) {
  const { coursePublications, courseEnrollments } = await getMongoCollections();
  const publication = await coursePublications.findOne({ _id: publicationId, ...scope(botId, guildId) });
  if (!publication) return { error: "not_found" as const };
  if (publication.status !== "open") return { error: "closed" as const, publication: mapPublication(publication) };
  if (!publication.students.includes(userId)) return { error: "not_joined" as const, publication: mapPublication(publication) };
  await coursePublications.updateOne({ _id: publicationId, ...scope(botId, guildId) }, { $pull: { students: userId }, $set: { updatedAt: new Date() } });
  await courseEnrollments.updateOne(
    { ...scope(botId, guildId), publicationId, studentId: userId },
    { $set: { enrollmentStatus: "LEFT", examStatus: "CANCELED", updatedAt: new Date() } }
  );
  const updated = await coursePublications.findOne({ _id: publicationId, ...scope(botId, guildId) });
  await logCourseAction(botId, guildId, "course.student_left", userId, publication.courseId, publicationId, { userId });
  emitRealtime("courses:publication", { botId, guildId, publicationId });
  return { publication: mapPublication(updated ?? publication) };
}

export async function setCourseEnrollmentExamChannel(botId: string | null, guildId: string, publicationId: string, input: { channelId: string; studentId: string; studentName: string }) {
  const { coursePublications, courseEnrollments, courseExamSettings } = await getMongoCollections();
  const publication = await coursePublications.findOne({
    _id: publicationId, ...scope(botId, guildId), status: { $in: ["started", "proof"] }, students: input.studentId
  });
  if (!publication) return null;
  const exam = await courseExamSettings.findOne({ ...scope(botId, guildId), courseId: publication.courseId, enabled: true });
  if (!exam) return null;
  const now = new Date();
  const updated = await courseEnrollments.updateOne(
    { ...scope(botId, guildId), publicationId, studentId: input.studentId, enrollmentStatus: "ENROLLED", examStatus: "STARTING" },
    {
      $set: {
        courseId: publication.courseId, studentName: input.studentName.trim().slice(0, 100) || input.studentId,
        publicationChannelId: publication.channelId, enrollmentStatus: "ENROLLED", examId: exam._id,
        examStatus: "STARTING", examChannelId: input.channelId, updatedAt: now
      }
    }
  );
  if (updated.matchedCount === 0) return null;
  emitRealtime("courses:publication", { botId, guildId, publicationId });
  return courseEnrollments.findOne({ ...scope(botId, guildId), publicationId, studentId: input.studentId });
}

export async function expireCourseEnrollmentChannel(botId: string | null, guildId: string, channelId: string) {
  const { courseEnrollments } = await getMongoCollections();
  const enrollment = await courseEnrollments.findOne({ ...scope(botId, guildId), examChannelId: channelId });
  if (!enrollment) return null;
  const now = new Date();
  const nextStatus = ["AVAILABLE", "STARTING", "IN_PROGRESS"].includes(enrollment.examStatus) ? "EXPIRED" : enrollment.examStatus;
  await courseEnrollments.updateOne(
    { _id: enrollment._id, ...scope(botId, guildId) },
    { $set: { examChannelId: null, examStatus: nextStatus, updatedAt: now } }
  );
  await logCourseAction(botId, guildId, "course.exam_channel_removed", null, enrollment.courseId, enrollment.publicationId, {
    channelId, studentId: enrollment.studentId, previousStatus: enrollment.examStatus, status: nextStatus
  });
  emitRealtime("courses:publication", { botId, guildId, publicationId: enrollment.publicationId });
  return { ...enrollment, examChannelId: null, examStatus: nextStatus, updatedAt: now };
}

export async function setCoursePublicationStatus(botId: string | null, guildId: string, publicationId: string, status: "started" | "cancelled" | "closed" | "proof" | "finished", actorId: string) {
  const { coursePublications, courseEnrollments, courseExamSettings } = await getMongoCollections();
  const publication = await coursePublications.findOne({ _id: publicationId, ...scope(botId, guildId) });
  if (!publication) return null;
  const now = new Date();
  const allowedStatuses = publicationStatusTransitionSources(status);
  const transition = await coursePublications.updateOne({ _id: publicationId, ...scope(botId, guildId), ...(allowedStatuses ? { status: { $in: allowedStatuses } } : {}) }, {
    $set: {
      cancelledAt: status === "cancelled" ? now : publication.cancelledAt,
      cancelledBy: status === "cancelled" ? actorId : publication.cancelledBy,
      startedBy: status === "started" ? actorId : publication.startedBy ?? null,
      startedAt: status === "started" ? now : publication.startedAt ?? null,
      proofStartedBy: status === "proof" ? actorId : publication.proofStartedBy ?? null,
      proofStartedAt: status === "proof" ? now : publication.proofStartedAt ?? null,
      finishedBy: status === "finished" || status === "closed" ? actorId : publication.finishedBy ?? null,
      finishedAt: status === "finished" || status === "closed" ? now : publication.finishedAt ?? null,
      status,
      updatedAt: now
    }
  });
  if (transition.matchedCount === 0) return null;
  const examSettings = status === "started" || status === "proof"
    ? await courseExamSettings.findOne({ ...scope(botId, guildId), courseId: publication.courseId })
    : null;
  const examStatus = status === "started" || status === "proof" ? "AVAILABLE" : status === "cancelled" ? "CANCELED" : null;
  if (examStatus) {
    await courseEnrollments.updateMany(
      { ...scope(botId, guildId), publicationId, enrollmentStatus: "ENROLLED", examStatus: { $in: ["NOT_AVAILABLE", "AVAILABLE"] } },
      { $set: { examId: examSettings?._id ?? null, examStatus, updatedAt: now } }
    );
  }
  const updated = await coursePublications.findOne({ _id: publicationId, ...scope(botId, guildId) });
  await logCourseAction(botId, guildId, `course.${status}`, actorId, publication.courseId, publicationId, { from: publication.status, to: status });
  emitRealtime("courses:publication", { botId, guildId, publicationId });
  return mapPublication(updated ?? publication);
}

function publicationStatusTransitionSources(status: MongoCoursePublication["status"]): MongoCoursePublication["status"][] | null {
  if (status === "started") return ["open"];
  if (status === "proof") return ["started"];
  if (status === "finished") return ["started", "proof"];
  if (status === "closed") return ["open", "started", "proof"];
  if (status === "cancelled") return ["open", "started"];
  return null;
}

export async function createScheduleRequest(botId: string | null, guildId: string, input: {
  courseId: string;
  instructorId: string;
  requestedDate: string;
  requestedTime: string;
  location: string;
  notes?: string | null;
  channelId?: string | null;
}) {
  const { courseScheduleRequests } = await getMongoCollections();
  const now = new Date();
  const doc: MongoCourseScheduleRequest = {
    _id: randomUUID(),
    botId,
    guildId,
    courseId: input.courseId,
    instructorId: input.instructorId,
    requestedDate: input.requestedDate,
    requestedTime: input.requestedTime,
    location: input.location,
    notes: input.notes || null,
    status: "pending",
    decidedBy: null,
    decidedAt: null,
    channelId: input.channelId ?? null,
    messageId: null,
    createdAt: now,
    updatedAt: now
  };
  await courseScheduleRequests.insertOne(doc);
  await logCourseAction(botId, guildId, "course.schedule_requested", input.instructorId, input.courseId, null, input);
  emitRealtime("courses:schedule", { botId, guildId, requestId: doc._id });
  return mapScheduleRequest(doc);
}

export async function updateScheduleRequest(botId: string | null, guildId: string, requestId: string, input: Partial<Pick<MongoCourseScheduleRequest, "messageId" | "status" | "decidedBy" | "decidedAt">>) {
  const { courseScheduleRequests } = await getMongoCollections();
  await courseScheduleRequests.updateOne({ _id: requestId, ...scope(botId, guildId) }, { $set: { ...input, updatedAt: new Date() } });
  const request = await courseScheduleRequests.findOne({ _id: requestId, ...scope(botId, guildId) });
  if (!request) return null;
  if (input.status) await logCourseAction(botId, guildId, `course.schedule_${input.status}`, input.decidedBy ?? null, request.courseId, null, { requestId });
  emitRealtime("courses:schedule", { botId, guildId, requestId });
  return mapScheduleRequest(request);
}

export async function getScheduleRequest(botId: string | null, guildId: string, requestId: string) {
  const { courseScheduleRequests } = await getMongoCollections();
  const request = await courseScheduleRequests.findOne({ _id: requestId, ...scope(botId, guildId) });
  return request ? mapScheduleRequest(request) : null;
}

export async function createCourseReport(botId: string | null, guildId: string, input: {
  channelId?: string | null;
  courseId: string;
  instructorId: string;
  messageId?: string | null;
  reportDate: string;
  reportTime: string;
  students: MongoCourseReport["students"];
}) {
  const { courseReports } = await getMongoCollections();
  const doc: MongoCourseReport = {
    _id: randomUUID(),
    botId,
    guildId,
    courseId: input.courseId,
    instructorId: input.instructorId,
    reportDate: input.reportDate,
    reportTime: input.reportTime,
    students: input.students,
    channelId: input.channelId ?? null,
    messageId: input.messageId ?? null,
    createdAt: new Date()
  };
  await courseReports.insertOne(doc);
  await logCourseAction(botId, guildId, "course.report_created", input.instructorId, input.courseId, null, { students: input.students.length });
  emitRealtime("courses:report", { botId, guildId, reportId: doc._id });
  return mapReport(doc);
}

export function isCourseManager(settings: CourseSettingsDto, userId: string, roleIds: string[]) {
  return settings.adminUserIds.includes(userId)
    || settings.managerUserIds.includes(userId)
    || settings.configUserIds.includes(userId)
    || settings.adminRoleIds.some((roleId) => roleIds.includes(roleId))
    || settings.managerRoleIds.some((roleId) => roleIds.includes(roleId))
    || settings.configRoleIds.some((roleId) => roleIds.includes(roleId));
}

export function hasCourseModulePermission(settings: CourseSettingsDto, userId: string, roleIds: string[], permission: string) {
  if (isCourseManager(settings, userId, roleIds)) return true;
  const rule = settings.permissionMatrix?.[permission];
  if (!rule) return false;
  return rule.userIds.includes(userId) || rule.roleIds.some((roleId) => roleIds.includes(roleId));
}

export async function logCourseAction(botId: string | null, guildId: string, action: string, actorId: string | null, courseId: string | null, publicationId: string | null, data: Record<string, unknown>) {
  const { courseLogs } = await getMongoCollections();
  await courseLogs.insertOne({
    _id: randomUUID(),
    botId,
    guildId,
    action,
    actorId,
    courseId,
    publicationId,
    data,
    createdAt: new Date()
  });
}

function mapSettings(settings: MongoCourseSettings) {
  const images = settings.images ?? [];
  return {
    id: settings._id,
    botId: settings.botId,
    guildId: settings.guildId,
    publishChannelId: settings.publishChannelId,
    scheduleChannelId: settings.scheduleChannelId,
    scheduleLogChannelId: settings.scheduleLogChannelId ?? settings.scheduleChannelId,
    proofLogChannelId: settings.proofLogChannelId ?? settings.logChannelId,
    resultChannelId: settings.resultChannelId ?? settings.reportChannelId,
    evaluationChannelId: settings.evaluationChannelId ?? settings.reportChannelId,
    reportChannelId: settings.reportChannelId,
    logChannelId: settings.logChannelId,
    adminLogChannelId: settings.adminLogChannelId ?? settings.logChannelId,
    temporaryCategoryId: settings.temporaryCategoryId,
    tempProofCategoryId: settings.tempProofCategoryId ?? settings.temporaryCategoryId,
    evaluatorMentionRoleId: settings.evaluatorMentionRoleId ?? null,
    resultMentionRoleId: settings.resultMentionRoleId ?? null,
    adminUserIds: settings.adminUserIds ?? [],
    adminRoleIds: settings.adminRoleIds ?? [],
    managerUserIds: settings.managerUserIds ?? [],
    managerRoleIds: settings.managerRoleIds ?? [],
    generalInstructorRoleIds: settings.generalInstructorRoleIds ?? [],
    globalInstructorUserIds: settings.globalInstructorUserIds ?? [],
    globalInstructorRoleIds: settings.globalInstructorRoleIds ?? settings.generalInstructorRoleIds ?? [],
    evaluatorUserIds: settings.evaluatorUserIds ?? [],
    evaluatorRoleIds: settings.evaluatorRoleIds ?? [],
    configUserIds: settings.configUserIds ?? [],
    configRoleIds: settings.configRoleIds ?? [],
    permissionMatrix: settings.permissionMatrix ?? {},
    images: images.map(mapImage),
    defaultExpirationHours: settings.defaultExpirationHours ?? DEFAULT_COURSE_CHANNEL_EXPIRATION_HOURS,
    noPermissionMessage: settings.noPermissionMessage,
    cancelledMessage: settings.cancelledMessage,
    startedMessage: settings.startedMessage,
    globalBannerUrl: settings.globalBannerUrl ?? null,
    reportImageUrl: settings.reportImageUrl ?? null,
    panelMessageId: settings.panelMessageId ?? null,
    lastPanelRequestedAt: settings.lastPanelRequestedAt?.toISOString() ?? null,
    buttonEmojis: settings.buttonEmojis,
    updatedAt: settings.updatedAt.toISOString()
  };
}

function mapCourse(course: MongoCourse) {
  return {
    id: course._id,
    botId: course.botId,
    guildId: course.guildId,
    name: course.name,
    code: course.code ?? null,
    description: course.description,
    emoji: course.emoji,
    color: course.color,
    bannerUrl: course.bannerUrl,
    proofBannerUrl: course.proofBannerUrl ?? null,
    footerImageUrl: course.footerImageUrl,
    thumbnailUrl: course.thumbnailUrl,
    imagePosition: course.imagePosition,
    publishText: course.publishText,
    proofInstructionText: course.proofInstructionText ?? null,
    startedText: course.startedText,
    cancelledText: course.cancelledText,
    buttonLabels: course.buttonLabels,
    instructorUserIds: course.instructorUserIds,
    instructorRoleIds: course.instructorRoleIds,
    allowGeneralInstructorRoles: course.allowGeneralInstructorRoles ?? true,
    publishChannelId: null,
    maxStudents: course.maxStudents ?? 30,
    location: course.location ?? null,
    defaultSchedule: course.defaultSchedule ?? null,
    active: course.active,
    createdBy: course.createdBy,
    updatedBy: course.updatedBy ?? null,
    createdAt: course.createdAt.toISOString(),
    updatedAt: course.updatedAt.toISOString()
  };
}

function mapPublication(publication: MongoCoursePublication) {
  return {
    id: publication._id,
    botId: publication.botId,
    guildId: publication.guildId,
    courseId: publication.courseId,
    channelId: publication.channelId,
    messageId: publication.messageId,
    discordEventId: publication.discordEventId ?? null,
    discordEventUrl: publication.discordEventUrl ?? null,
    discordEventType: publication.discordEventType ?? "EXTERNAL",
    voiceChannelId: publication.voiceChannelId ?? null,
    scheduledStartAt: publication.scheduledStartAt?.toISOString() ?? null,
    scheduledEndAt: publication.scheduledEndAt?.toISOString() ?? null,
    lastSyncAt: publication.lastSyncAt?.toISOString() ?? null,
    syncError: publication.syncError ?? null,
    instructorId: publication.instructorId,
    location: publication.location,
    legacyLocation: publication.legacyLocation ?? null,
    dpId: publication.dpId ?? null,
    dpNameSnapshot: publication.dpNameSnapshot ?? null,
    scheduledFor: publication.scheduledFor,
    capacity: publication.capacity,
    students: publication.students,
    notes: publication.notes,
    status: publication.status,
    workflowStatus: publication.status === "started" || publication.status === "proof" ? "EM_ANDAMENTO" : publication.status === "open" ? "INSCRICOES_ABERTAS" : publication.status.toUpperCase(),
    cancelledBy: publication.cancelledBy,
    cancelledAt: publication.cancelledAt?.toISOString() ?? null,
    startedBy: publication.startedBy ?? null,
    startedAt: publication.startedAt?.toISOString() ?? null,
    proofStartedBy: publication.proofStartedBy ?? null,
    proofStartedAt: publication.proofStartedAt?.toISOString() ?? null,
    finishedBy: publication.finishedBy ?? null,
    finishedAt: publication.finishedAt?.toISOString() ?? null,
    createdAt: publication.createdAt.toISOString(),
    updatedAt: publication.updatedAt.toISOString()
  };
}

function mapCourseDepartment(department: MongoCourseDepartment) {
  return {
    id: department._id,
    botId: department.botId,
    guildId: department.guildId,
    name: department.name,
    normalizedName: department.normalizedName,
    active: department.active,
    createdBy: department.createdBy,
    updatedBy: department.updatedBy ?? null,
    createdAt: department.createdAt.toISOString(),
    updatedAt: department.updatedAt.toISOString()
  };
}

function parseOptionalDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function mapEnrollment(enrollment: MongoCourseEnrollment) {
  return {
    id: enrollment._id,
    botId: enrollment.botId,
    guildId: enrollment.guildId,
    courseId: enrollment.courseId,
    publicationId: enrollment.publicationId,
    studentId: enrollment.studentId,
    studentName: enrollment.studentName,
    publicationChannelId: enrollment.publicationChannelId,
    enrolledAt: enrollment.enrolledAt.toISOString(),
    enrollmentStatus: enrollment.enrollmentStatus,
    examId: enrollment.examId,
    examStatus: enrollment.examStatus,
    studentStatus: enrollment.examStatus === "NOT_AVAILABLE" ? "INSCRITO"
      : enrollment.examStatus === "AVAILABLE" ? "PROVA_DISPONIVEL"
        : enrollment.examStatus === "STARTING" || enrollment.examStatus === "IN_PROGRESS" ? "REALIZANDO_PROVA"
          : enrollment.examStatus === "COMPLETED" ? "PROVA_CONCLUIDA"
            : enrollment.examStatus === "APPROVED" ? "APROVADO"
              : enrollment.examStatus === "FAILED" ? "REPROVADO" : enrollment.examStatus,
    attemptId: enrollment.attemptId,
    attemptNumber: enrollment.attemptId ? 1 : 0,
    examChannelId: enrollment.examChannelId,
    examStartedAt: enrollment.examStartedAt?.toISOString() ?? null,
    score: enrollment.score,
    correctAnswers: enrollment.correctAnswers,
    result: enrollment.result,
    completedAt: enrollment.completedAt?.toISOString() ?? null,
    correctedBy: enrollment.correctedBy,
    transcriptId: enrollment.transcriptId,
    updatedAt: enrollment.updatedAt.toISOString()
  };
}

function mapScheduleRequest(request: MongoCourseScheduleRequest) {
  return {
    id: request._id,
    botId: request.botId,
    guildId: request.guildId,
    courseId: request.courseId,
    instructorId: request.instructorId,
    requestedDate: request.requestedDate,
    requestedTime: request.requestedTime,
    location: request.location,
    notes: request.notes,
    status: request.status,
    decidedBy: request.decidedBy,
    decidedAt: request.decidedAt?.toISOString() ?? null,
    channelId: request.channelId,
    messageId: request.messageId,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString()
  };
}

function mapReport(report: MongoCourseReport) {
  return {
    id: report._id,
    botId: report.botId,
    guildId: report.guildId,
    courseId: report.courseId,
    instructorId: report.instructorId,
    reportDate: report.reportDate,
    reportTime: report.reportTime,
    students: report.students,
    channelId: report.channelId,
    messageId: report.messageId,
    createdAt: report.createdAt.toISOString()
  };
}

function mapLog(log: { _id: string; action: string; actorId: string | null; courseId: string | null; publicationId: string | null; data: Record<string, unknown>; createdAt: Date }) {
  return {
    id: log._id,
    action: log.action,
    type: (log as { type?: string }).type ?? log.action,
    actorId: log.actorId,
    authorId: (log as { authorId?: string | null }).authorId ?? log.actorId,
    targetId: (log as { targetId?: string | null }).targetId ?? null,
    courseId: log.courseId,
    publicationId: log.publicationId,
    sessionId: (log as { sessionId?: string | null }).sessionId ?? null,
    channelId: (log as { channelId?: string | null }).channelId ?? null,
    status: (log as { status?: string | null }).status ?? null,
    data: log.data,
    metadata: (log as { metadata?: Record<string, unknown> }).metadata ?? log.data,
    createdAt: log.createdAt.toISOString()
  };
}

function mapImage(image: MongoCourseImage) {
  const raw = image as MongoCourseImage & { id?: string; createdAt?: Date | string };
  const createdAt = raw.createdAt instanceof Date ? raw.createdAt : new Date(raw.createdAt ?? Date.now());
  return {
    id: image._id ?? raw.id,
    botId: image.botId,
    guildId: image.guildId,
    name: image.name,
    type: image.type,
    url: image.url,
    createdAt: createdAt.toISOString(),
    createdBy: image.createdBy,
    active: image.active,
    default: image.default
  };
}

function cleanSettings(input: CourseSettingsUpdate) {
  const cleaned: Record<string, unknown> = { ...input };
  for (const key of [
    "publishChannelId",
    "scheduleChannelId",
    "scheduleLogChannelId",
    "proofLogChannelId",
    "resultChannelId",
    "evaluationChannelId",
    "reportChannelId",
    "logChannelId",
    "adminLogChannelId",
    "temporaryCategoryId",
    "tempProofCategoryId"
  ] as const) {
    if (key in input) cleaned[key] = input[key] || null;
  }
  if ("defaultExpirationHours" in input) {
    cleaned.defaultExpirationHours = input.defaultExpirationHours ?? DEFAULT_COURSE_CHANNEL_EXPIRATION_HOURS;
  }
  delete cleaned.lastPanelRequestedAt;
  return cleaned;
}

function cleanCourse(input: Partial<CourseDto>) {
  const allowed: Partial<MongoCourse> = {};
  for (const key of [
    "active",
    "bannerUrl",
    "proofBannerUrl",
    "buttonLabels",
    "cancelledText",
    "color",
    "code",
    "description",
    "emoji",
    "footerImageUrl",
    "imagePosition",
    "instructorRoleIds",
    "instructorUserIds",
    "allowGeneralInstructorRoles",
    "maxStudents",
    "location",
    "name",
    "defaultSchedule",
    "proofInstructionText",
    "publishText",
    "startedText",
    "thumbnailUrl"
  ] as const) {
    if (input[key] !== undefined) (allowed as Record<string, unknown>)[key] = input[key];
  }
  return allowed;
}

function sanitizeCourseDepartmentName(input: string) {
  const name = input.replace(/\s+/g, " ").trim();
  if (name.length < COURSE_DEPARTMENT_NAME_MIN || name.length > COURSE_DEPARTMENT_NAME_MAX) {
    throw new CourseDepartmentError("invalid_name", `O nome da DP deve ter entre ${COURSE_DEPARTMENT_NAME_MIN} e ${COURSE_DEPARTMENT_NAME_MAX} caracteres.`);
  }
  return name;
}

function normalizeCourseDepartmentName(input: string) {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isDuplicateKeyError(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === 11000;
}

function scope(botId: string | null, guildId: string) {
  return { botId, guildId };
}
