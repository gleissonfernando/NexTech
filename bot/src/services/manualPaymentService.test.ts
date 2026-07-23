import assert from "node:assert/strict";
import test from "node:test";
import { PermissionFlagsBits, type Guild } from "discord.js";
import type { ManualPaymentSettings } from "./apiClient";
import {
  buildPrivatePaymentChannelOverwrites,
  getReceiptExtension,
  isReceiptImageAttachment,
  isValidReceiptAttachment,
  receiptAttachmentExtension
} from "./manualPaymentService";

function settingsWithRoles(): ManualPaymentSettings {
  return {
    allowedReceiptImageFormats: ["png", "jpg", "jpeg", "webp"],
    allowReceiptPdf: true,
    approveRoleIds: ["approver-admin", "approver-staff"],
    attendanceCategoryId: null,
    autoReceiptDetectionEnabled: true,
    bannerUrl: null,
    botId: "bot-runtime",
    color: "#22c55e",
    enabled: true,
    finalizeRoleIds: ["finalizer-staff"],
    guildId: "guild",
    id: "settings",
    logChannelId: null,
    logViewRoleIds: ["viewer-staff"],
    maxPaymentMinutes: 60,
    paymentCategoryId: null,
    approvalMessage: "aprovado",
    customerReceiptMessage: "recebido",
    paymentInstructions: "",
    pixCopyPasteCode: null,
    pixKey: null,
    pixKeyType: "random",
    pixQrCodeUrl: null,
    receiverBank: null,
    receiverName: null,
    receiptChannelId: null,
    rejectRoleIds: ["reject-admin"],
    rejectionMessage: "recusado",
    salePanelChannelId: null,
    salePanelDescription: "",
    salePanelMessageId: null,
    salePanelTitle: "Servicos",
    services: [],
    supportPanelChannelId: null,
    updatedAt: new Date().toISOString()
  };
}

function guildWithRoles() {
  const role = (admin: boolean) => ({
    permissions: {
      has: (permission: bigint) => admin && permission === PermissionFlagsBits.Administrator
    }
  });

  return {
    client: { user: { id: "bot-user" } },
    members: { me: { id: "bot-user" } },
    ownerId: "owner-user",
    roles: {
      cache: new Map([
        ["approver-admin", role(true)],
        ["approver-staff", role(false)],
        ["finalizer-staff", role(false)],
        ["reject-admin", role(true)],
        ["viewer-staff", role(false)]
      ]),
      everyone: { id: "everyone" }
    }
  } as unknown as Guild;
}

test("canal temporario de pagamento libera somente comprador, bot, dono e cargos admin", () => {
  const overwrites = buildPrivatePaymentChannelOverwrites(guildWithRoles(), settingsWithRoles(), "buyer-user");

  assert.deepEqual(overwrites.map((overwrite) => overwrite.id), [
    "everyone",
    "buyer-user",
    "bot-user",
    "owner-user",
    "approver-admin",
    "reject-admin"
  ]);

  const botOverwrite = overwrites.find((overwrite) => overwrite.id === "bot-user");
  const botAllow = botOverwrite?.allow ?? [];
  assert.ok(botAllow.includes(PermissionFlagsBits.AttachFiles));
  assert.ok(botAllow.includes(PermissionFlagsBits.EmbedLinks));
});

test("comprovante manual aceita imagens principais e pdf opcional por MIME ou extensão", () => {
  const cases = [
    { contentType: "image/png", name: "print.png", url: "https://cdn.test/print.png" },
    { contentType: "image/jpeg", name: "foto.jpg", url: "https://cdn.test/foto.jpg" },
    { contentType: "image/jpg", name: "celular.jpg", url: "https://cdn.test/celular.jpg" },
    { contentType: null, name: "captura.jpeg", url: "https://cdn.test/captura.jpeg?ex=1" },
    { contentType: null, name: "arquivo", url: "https://cdn.test/upload.webp?token=abc" },
    { contentType: "application/pdf", name: "comprovante.pdf", url: "https://cdn.test/comprovante.pdf" }
  ];

  for (const item of cases) {
    assert.equal(isValidReceiptAttachment(item), true, `${item.name} deveria ser aceito`);
  }
});

test("comprovante manual rejeita tipo inválido e detecta imagens por extensão", () => {
  assert.equal(isValidReceiptAttachment({ contentType: "application/zip", name: "arquivo.zip", url: "https://cdn.test/arquivo.zip" }), false);
  assert.equal(isValidReceiptAttachment({ contentType: "image/gif; charset=binary", name: "animado.gif", url: "https://cdn.test/animado.gif" }), false);
  assert.equal(isValidReceiptAttachment({ contentType: null, name: "sem-extensao", url: "https://cdn.test/file" }), false);
  assert.equal(isReceiptImageAttachment({ contentType: null, name: "screenshot", url: "https://cdn.test/screenshot.PNG?x=1" }), true);
  assert.equal(isReceiptImageAttachment({ contentType: "application/pdf", name: "comprovante.pdf", url: "https://cdn.test/comprovante.pdf" }), false);
  assert.equal(receiptAttachmentExtension({ contentType: null, name: "", url: "https://cdn.test/minha%20foto.webp?token=1" }), "webp");
  assert.equal(getReceiptExtension("COMPROVANTE.JPEG"), "jpeg");
});
