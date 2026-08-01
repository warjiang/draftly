import assert from "node:assert/strict";
import { test } from "node:test";
import { groupDraftsByProject } from "../src/lib/drafts.js";

test("groups duplicate projects and selects the most recently active draft", () => {
  const groups = groupDraftsByProject([
    {
      id: "older",
      title: "SaaS 定价页",
      prompt: "做一个 SaaS 定价页",
      createdAt: "2026-08-01T02:00:00.000Z",
      versions: [{ v: 1, at: "2026-08-01T03:00:00.000Z" }],
    },
    {
      id: "latest",
      title: "SaaS 定价页",
      prompt: "  做一个   SaaS 定价页 ",
      createdAt: "2026-08-01T04:00:00.000Z",
      versions: [{ v: 1, at: "2026-08-01T04:10:00.000Z" }, { v: 2, at: "2026-08-01T05:00:00.000Z" }],
    },
    {
      id: "other",
      title: "数据工作台",
      prompt: "做一个数据工作台",
      createdAt: "2026-07-31T04:00:00.000Z",
      versions: [],
    },
  ]);

  assert.equal(groups.length, 2);
  assert.equal(groups[0].latest.id, "latest");
  assert.equal(groups[0].revisionCount, 2);
  assert.deepEqual(groups[0].drafts.map((draft) => draft.id), ["latest", "older"]);
  assert.equal(groups[1].latest.id, "other");
});

test("falls back to title when legacy drafts do not have a prompt", () => {
  const groups = groupDraftsByProject([
    { id: "one", title: "欢迎页面", createdAt: "2026-08-01T01:00:00.000Z", versions: [] },
    { id: "two", title: " 欢迎页面 ", createdAt: "2026-08-01T02:00:00.000Z", versions: [] },
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].latest.id, "two");
});
