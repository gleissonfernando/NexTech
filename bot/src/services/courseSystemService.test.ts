import assert from "node:assert/strict";
import test from "node:test";
import { OverwriteType, PermissionFlagsBits } from "discord.js";
import {
  courseExamChannelTopic,
  examPermissionOverwrites,
  isCourseExamChannelFor,
  parseCourseExamChannelTopic,
  shouldDeferExamChannelDeletion
} from "./courseSystemService";

test("marcador do canal de prova preserva os estados preparing, ready e finished", () => {
  const publicationId = "publication-1";
  const studentId = "student-1";
  const baseTopic = courseExamChannelTopic(publicationId, studentId);

  assert.deepEqual(parseCourseExamChannelTopic(baseTopic), {
    deleteAt: null,
    publicationId,
    state: "preparing",
    studentId
  });
  assert.deepEqual(parseCourseExamChannelTopic(`${baseTopic}:ready`), {
    deleteAt: null,
    publicationId,
    state: "ready",
    studentId
  });

  const deleteAtSeconds = 1_800_000_000;
  assert.deepEqual(parseCourseExamChannelTopic(`${baseTopic}:finished:${deleteAtSeconds}`), {
    deleteAt: deleteAtSeconds * 1_000,
    publicationId,
    state: "finished",
    studentId
  });
});

test("canal de prova corresponde somente à publicação e ao aluno do marcador", () => {
  const topic = courseExamChannelTopic("publication-1", "student-1");

  assert.equal(isCourseExamChannelFor(topic, "publication-1", "student-1"), true);
  assert.equal(isCourseExamChannelFor(topic, "publication-2", "student-1"), false);
  assert.equal(isCourseExamChannelFor(topic, "publication-1", "student-2"), false);
  assert.equal(isCourseExamChannelFor("marcador-invalido", "publication-1", "student-1"), false);
});

test("limpeza aguarda uma tentativa ativa, mas não adia canal já finalizado", () => {
  const topic = courseExamChannelTopic("publication-1", "student-1");

  assert.equal(shouldDeferExamChannelDeletion(`${topic}:ready`, true), true);
  assert.equal(shouldDeferExamChannelDeletion(topic, true), true);
  assert.equal(shouldDeferExamChannelDeletion(`${topic}:ready`, false), false);
  assert.equal(shouldDeferExamChannelDeletion(`${topic}:finished:1800000000`, true), false);
});

test("overwrites isolam o aluno e tipam usuários, cargos e bot corretamente", () => {
  type ExamPermissionParameters = Parameters<typeof examPermissionOverwrites>;

  const guild = {
    roles: { everyone: { id: "role-everyone" } }
  } as unknown as ExamPermissionParameters[0];
  const context = {
    client: { user: { id: "bot-1" } }
  } as unknown as ExamPermissionParameters[1];
  const publication = {
    instructorId: "instructor-1"
  } as unknown as ExamPermissionParameters[2];
  const course = {
    instructorRoleIds: ["role-course-instructor"],
    instructorUserIds: ["user-course-instructor"]
  } as unknown as ExamPermissionParameters[3];
  const settings = {
    adminRoleIds: ["role-admin"],
    adminUserIds: ["user-admin"],
    evaluatorRoleIds: ["role-evaluator"],
    evaluatorUserIds: ["user-evaluator"],
    generalInstructorRoleIds: ["role-general-instructor"],
    globalInstructorRoleIds: ["role-global-instructor"],
    globalInstructorUserIds: ["user-global-instructor"],
    managerRoleIds: ["role-manager"],
    managerUserIds: ["user-manager"]
  } as unknown as ExamPermissionParameters[4];

  const overwrites = examPermissionOverwrites(guild, context, publication, course, settings, "student-1");
  const byId = new Map(overwrites.map((overwrite) => [overwrite.id, overwrite]));
  const everyone = byId.get("role-everyone");

  assert.equal(everyone?.type, OverwriteType.Role);
  assert.equal(everyone?.deny?.includes(PermissionFlagsBits.ViewChannel), true);
  assert.equal(byId.has("student-2"), false);

  for (const id of [
    "student-1",
    "instructor-1",
    "user-course-instructor",
    "user-admin",
    "user-manager",
    "user-evaluator",
    "user-global-instructor"
  ]) {
    const overwrite = byId.get(id);
    assert.equal(overwrite?.type, OverwriteType.Member, `${id} deve ser Member`);
    assert.equal(overwrite?.allow?.includes(PermissionFlagsBits.ViewChannel), true, `${id} deve visualizar o canal`);
  }

  for (const id of [
    "role-course-instructor",
    "role-admin",
    "role-manager",
    "role-evaluator",
    "role-global-instructor",
    "role-general-instructor"
  ]) {
    const overwrite = byId.get(id);
    assert.equal(overwrite?.type, OverwriteType.Role, `${id} deve ser Role`);
    assert.equal(overwrite?.allow?.includes(PermissionFlagsBits.ViewChannel), true, `${id} deve visualizar o canal`);
  }

  const bot = byId.get("bot-1");
  assert.equal(bot?.type, OverwriteType.Member);
  assert.equal(bot?.allow?.includes(PermissionFlagsBits.ViewChannel), true);
  assert.equal(bot?.allow?.includes(PermissionFlagsBits.ManageChannels), true);
});
