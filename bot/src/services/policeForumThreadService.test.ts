import assert from "node:assert/strict";
import test from "node:test";
import { ensureOfficerForumThread, officerThreadName } from "./policeForumThreadService";

function fakeForum(options: { archivedThreads?: any[]; channels?: Record<string, any>; requireTag?: boolean } = {}) {
  const created: any[] = [];
  const forum: any = {
    availableTags: [{ id: "tag-1" }],
    flags: { has: () => Boolean(options.requireTag) },
    guild: { channels: { fetch: async (id: string) => options.channels?.[id] ?? null } },
    id: "forum-1",
    threads: {
      create: async (payload: any) => { created.push(payload); return { ...payload, id: `thread-${created.length}` }; },
      fetchActive: async () => ({ threads: { find: () => null } }),
      fetchArchived: async () => ({ threads: { find: (predicate: (thread: any) => boolean) => (options.archivedThreads ?? []).find(predicate) ?? null } })
    }
  };
  return { created, forum };
}

function fakeThread(name: string, overrides: Record<string, unknown> = {}) {
  const thread: any = { archived: false, id: "thread-existente", isThread: () => true, locked: false, name, parentId: "forum-1", ...overrides };
  thread.setArchived = async (value: boolean) => { thread.archived = value; return thread; };
  thread.setLocked = async (value: boolean) => { thread.locked = value; return thread; };
  return thread;
}

const target = { discordId: "123456789012345678", displayName: "Vilão", header: { content: "cabeçalho" }, policeId: "1234" };

test("reaproveita a aba guardada em vez de abrir outro post", async () => {
  const existing = fakeThread(officerThreadName(target));
  const { created, forum } = fakeForum({ channels: { "thread-existente": existing } });
  const thread = await ensureOfficerForumThread(forum, { ...target, existingThreadId: "thread-existente" });
  assert.equal(thread.id, "thread-existente");
  assert.equal(created.length, 0);
});

test("reabre a aba arquivada antes de escrever nela", async () => {
  const existing = fakeThread(officerThreadName(target), { archived: true, locked: true });
  const { forum } = fakeForum({ channels: { "thread-existente": existing } });
  await ensureOfficerForumThread(forum, { ...target, existingThreadId: "thread-existente" });
  assert.equal(existing.archived, false);
  assert.equal(existing.locked, false);
});

test("acha a aba pelo nome quando o id guardado se perdeu", async () => {
  const archived = fakeThread(officerThreadName(target), { archived: true, id: "thread-antiga" });
  const { created, forum } = fakeForum({ archivedThreads: [archived] });
  const thread = await ensureOfficerForumThread(forum, { ...target, existingThreadId: null });
  assert.equal(thread.id, "thread-antiga");
  assert.equal(created.length, 0);
});

test("cria a aba com tag quando o fórum exige tag", async () => {
  const { created, forum } = fakeForum({ requireTag: true });
  const thread = await ensureOfficerForumThread(forum, { ...target, existingThreadId: null });
  assert.equal(thread.id, "thread-1");
  assert.deepEqual(created[0].appliedTags, ["tag-1"]);
  assert.equal(created[0].name, "recrutamento-Vilão | 1234");
});
