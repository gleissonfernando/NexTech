import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MongoAmmunitionOrder } from "../database/mongo";
import { summarizeAmmunitionOrders } from "./ammunitionService";

function order(input: Partial<MongoAmmunitionOrder>): MongoAmmunitionOrder {
  const now = new Date("2026-08-05T12:00:00.000Z");
  return {
    _id: input._id ?? "order-1",
    botId: null,
    buyerFactionId: input.buyerFactionId ?? "buyer-a",
    buyerFactionName: input.buyerFactionName ?? "Buyer A",
    cancelledAt: null,
    cancelledByUserId: null,
    cancelReason: null,
    cashIdempotencyKey: input.cashIdempotencyKey ?? `municao:guild:${input._id ?? "order-1"}`,
    cashTransactionId: input.cashTransactionId ?? null,
    completedAt: input.completedAt ?? now,
    completedByUserId: input.completedByUserId ?? "manager-1",
    createdAt: input.createdAt ?? now,
    guildId: "guild",
    itemEditingLocked: input.itemEditingLocked ?? true,
    items: input.items ?? [],
    openedByUserId: input.openedByUserId ?? "seller-1",
    orderNumber: input.orderNumber ?? 1,
    panelMessageId: null,
    processingStartedAt: null,
    quantity: input.quantity ?? 10,
    sellerFactionId: input.sellerFactionId ?? "seller-fac",
    sellerFactionName: input.sellerFactionName ?? "Seller FAC",
    sellerUserId: input.sellerUserId ?? "seller-1",
    status: input.status ?? "DELIVERED",
    temporaryChannelId: null,
    totalValueInCents: input.totalValueInCents ?? 5000,
    unitPriceInCents: input.unitPriceInCents ?? 500,
    updatedAt: input.updatedAt ?? now
  };
}

describe("summarizeAmmunitionOrders", () => {
  it("totaliza vendas entregues por FAC compradora e vendedor", () => {
    const start = new Date("2026-08-03T00:00:00.000Z");
    const end = new Date("2026-08-09T23:59:59.999Z");
    const summary = summarizeAmmunitionOrders([
      order({ _id: "1", buyerFactionId: "buyer-a", buyerFactionName: "Buyer A", quantity: 10, sellerUserId: "seller-1", totalValueInCents: 5000 }),
      order({ _id: "2", buyerFactionId: "buyer-a", buyerFactionName: "Buyer A", quantity: 5, sellerUserId: "seller-2", totalValueInCents: 2500 }),
      order({ _id: "3", buyerFactionId: "buyer-b", buyerFactionName: "Buyer B", quantity: 8, sellerUserId: "seller-1", totalValueInCents: 4000 })
    ], { sellerFactionId: "seller-fac" }, start, end);

    assert.equal(summary.orderCount, 3);
    assert.equal(summary.totalUnits, 23);
    assert.equal(summary.totalValueInCents, 11_500);
    assert.deepEqual(summary.buyers, [
      { count: 2, id: "buyer-a", name: "Buyer A", totalUnits: 15, totalValueInCents: 7500 },
      { count: 1, id: "buyer-b", name: "Buyer B", totalUnits: 8, totalValueInCents: 4000 }
    ]);
    assert.deepEqual(summary.sellers, [
      { count: 2, id: "seller-1", name: "seller-1", totalUnits: 18, totalValueInCents: 9000 },
      { count: 1, id: "seller-2", name: "seller-2", totalUnits: 5, totalValueInCents: 2500 }
    ]);
  });
});
