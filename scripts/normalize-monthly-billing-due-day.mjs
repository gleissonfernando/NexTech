import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import path from "node:path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const DEFAULT_DUE_DAY = 7;
const apply = process.argv.includes("--apply");
const mongoUri = process.env.MONGODB_URI?.trim();

if (!mongoUri) {
  throw new Error("MONGODB_URI nao configurado.");
}

const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 15000 });

try {
  await client.connect();
  const db = client.db(databaseNameFromUri(mongoUri));
  const customerResult = await normalizeMonthlyBillingCustomers(db);
  const botInvoiceResult = await normalizeOpenBotBillingInvoices(db);

  console.log(JSON.stringify({
    apply,
    monthlyBillingCustomers: customerResult,
    openBotBillingInvoices: botInvoiceResult
  }, null, 2));
} finally {
  await client.close().catch(() => undefined);
}

async function normalizeMonthlyBillingCustomers(db) {
  const customers = await db.collection("monthly_billing_customers").find({ deletedAt: null }).toArray();
  const changes = [];

  for (const customer of customers) {
    const firstDueDate = customer.firstDueDate instanceof Date ? customer.firstDueDate : new Date(customer.firstDueDate);
    if (Number.isNaN(firstDueDate.getTime())) continue;

    const normalizedDueDate = dueDateOnDefaultDay(firstDueDate);
    const currentDueDate = firstDueDate.getTime();
    const currentDueDay = Number(customer.fixedDueDay);
    const needsUpdate = currentDueDay !== DEFAULT_DUE_DAY || currentDueDate !== normalizedDueDate.getTime();

    if (!needsUpdate) continue;

    changes.push({
      _id: customer._id,
      botId: customer.botId,
      billingType: customer.billingType,
      customerName: customer.customerName,
      from: {
        fixedDueDay: customer.fixedDueDay,
        firstDueDate: firstDueDate.toISOString()
      },
      to: {
        fixedDueDay: DEFAULT_DUE_DAY,
        firstDueDate: normalizedDueDate.toISOString()
      }
    });

    if (apply) {
      await db.collection("monthly_billing_customers").updateOne(
        { _id: customer._id },
        {
          $set: {
            fixedDueDay: DEFAULT_DUE_DAY,
            firstDueDate: normalizedDueDate,
            updatedAt: new Date()
          }
        }
      );
    }
  }

  return { scanned: customers.length, changed: changes.length, changes };
}

async function normalizeOpenBotBillingInvoices(db) {
  const invoices = await db.collection("bot_billing_invoices").find({ status: { $in: ["pending", "overdue"] } }).toArray();
  const changes = [];

  for (const invoice of invoices) {
    const dueDate = invoice.dueDate instanceof Date ? invoice.dueDate : new Date(invoice.dueDate);
    if (Number.isNaN(dueDate.getTime())) continue;

    const normalizedDueDate = dueDateOnDefaultDay(dueDate);
    normalizedDueDate.setHours(23, 59, 59, 999);
    const dueMonth = monthKey(normalizedDueDate);
    const needsUpdate = dueDate.getTime() !== normalizedDueDate.getTime() || invoice.dueMonth !== dueMonth;

    if (!needsUpdate) continue;

    changes.push({
      _id: invoice._id,
      botId: invoice.botId,
      status: invoice.status,
      from: {
        dueDate: dueDate.toISOString(),
        dueMonth: invoice.dueMonth
      },
      to: {
        dueDate: normalizedDueDate.toISOString(),
        dueMonth
      }
    });

    if (apply) {
      await db.collection("bot_billing_invoices").updateOne(
        { _id: invoice._id },
        {
          $set: {
            dueDate: normalizedDueDate,
            dueMonth,
            pixExpiresAt: normalizedDueDate,
            updatedAt: new Date()
          }
        }
      );
    }
  }

  return { scanned: invoices.length, changed: changes.length, changes };
}

function dueDateOnDefaultDay(date) {
  const next = new Date(date);
  next.setDate(DEFAULT_DUE_DAY);
  return next;
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function databaseNameFromUri(uri) {
  const parsed = new URL(uri);
  const name = parsed.pathname.replace(/^\//, "");
  return name || "NexTech";
}
