import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildNexTechNoticePayloadForTest } from "./nexTechNoticeService";

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
      type: 12,
      items: [
        {
          media: {
            url: "attachment://nextech-avisos-banner.png"
          }
        }
      ]
    });
    assert.equal(payload.components[0]?.components.at(-2)?.type, 1);
  });
});
