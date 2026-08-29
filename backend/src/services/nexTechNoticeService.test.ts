import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildNexTechNoticePayloadForTest,
  clearNexTechStartupNoticePending,
  consumeNexTechStartupNoticePending,
  markNexTechStartupNoticePending,
  resolveNexTechNoticeRecipients
} from "./nexTechNoticeService";

describe("nexTechNoticeService", () => {
  it("monta DM de avisos em Components V2 com banner anexado", () => {
    const payload = buildNexTechNoticePayloadForTest({
      additionalInfo: "Informacao extra",
      buttonLabel: "Abrir Discord",
      buttonUrl: "https://discord.gg/nextech",
      createdBy: "123456789012345678",
      createdByName: "Dev",
      highlight: "Comunicado oficial",
      message: "Mensagem enviada aos responsaveis.",
      recipientMode: "global",
      recipientUserId: null,
      title: "SEJA UM CRIADOR NO HYPE!"
    }) as {
      attachments: Array<{ filename: string; id: string }>;
      components: Array<{ type: number; components: Array<Record<string, unknown>> }>;
      flags: number;
    };

    assert.equal(payload.flags, 32768);
    assert.equal(payload.attachments[0]?.filename, "nextech-avisos-banner.png");
    assert.equal(payload.components[0]?.type, 17);
    assert.deepEqual(payload.components[0]?.components[0], {
      type: 10,
      content: "# SEJA UM CRIADOR NO HYPE!"
    });
    assert.equal(payload.components[0]?.components[1]?.type, 14);
    assert.deepEqual(payload.components[0]?.components[2], {
      type: 12,
      items: [
        {
          media: {
            url: "attachment://nextech-avisos-banner.png"
          }
        }
      ]
    });
    assert.equal(payload.components[0]?.components.at(-2)?.type, 10);
    assert.equal(payload.components[0]?.components.at(-1)?.type, 14);
  });

  it("consome aviso de startup uma unica vez", () => {
    const botId = "123456789012345678";
    markNexTechStartupNoticePending(botId);
    assert.equal(consumeNexTechStartupNoticePending(botId), true);
    assert.equal(consumeNexTechStartupNoticePending(botId), false);
    clearNexTechStartupNoticePending(botId);
  });

  it("resolve destinatario unico quando o modo e pessoa", async () => {
    const recipients = await resolveNexTechNoticeRecipients({
      recipientMode: "person",
      recipientUserId: "1426287249020158018"
    });

    assert.equal(recipients.length, 1);
    assert.equal(recipients[0]?.userId, "1426287249020158018");
    assert.equal(recipients[0]?.botCount, 1);
  });
});
