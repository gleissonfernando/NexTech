import assert from "node:assert/strict";
import test from "node:test";
import { resolvePanelTicketCategory } from "./tickets";

test("resolvePanelTicketCategory ignora categoria ausente sem bloquear ticket", async () => {
  const category = await resolvePanelTicketCategory(
    {
      categoryId: "123456789012345678",
      guildId: "111111111111111111",
      openerId: "222222222222222222",
      panelId: "123456789012345678",
      moduleType: "default",
      subject: "Teste",
      ticketType: "support"
    },
    "333333333333333333",
    async () => null
  );

  assert.equal(category, null);
});

test("resolvePanelTicketCategory retorna a categoria encontrada", async () => {
  const category = await resolvePanelTicketCategory(
    {
      categoryId: "123456789012345678",
      guildId: "111111111111111111",
      openerId: "222222222222222222",
      panelId: "123456789012345678",
      moduleType: "default",
      subject: "Teste",
      ticketType: "support"
    },
    "333333333333333333",
    async () => ({ label: "Suporte", ticketType: "support" } as never)
  );

  assert.deepEqual(category, { label: "Suporte", ticketType: "support" });
});
