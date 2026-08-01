import assert from "node:assert/strict";
import { test } from "node:test";
import { groupDraftsByProject } from "../src/lib/drafts.js";
import { filterProjects, groupProjectsByActivity } from "../src/lib/projects.js";
import { projectPath, routeForPath } from "../src/lib/router.js";

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

test("parses home and project routes without accepting unsafe project ids", () => {
  assert.deepEqual(routeForPath("/"), { name: "home" });
  assert.deepEqual(routeForPath("/projects/p-abc-123"), {
    name: "project",
    projectId: "p-abc-123",
  });
  assert.deepEqual(routeForPath("/projects/../escape"), { name: "not-found" });
  assert.equal(projectPath("p-abc-123"), "/projects/p-abc-123");
});

test("filters projects across title, prompt, and design name and groups activity", () => {
  const projects = [
    {
      id: "today",
      title: "交易工作台",
      prompt: "查看订单",
      design: { name: "Vercel" },
      updatedAt: "2026-08-01T08:00:00.000Z",
    },
    {
      id: "month",
      title: "发布页面",
      prompt: "独立开发者产品",
      design: { name: "Stripe" },
      updatedAt: "2026-07-12T08:00:00.000Z",
    },
  ];

  assert.deepEqual(filterProjects(projects, "stripe").map((item) => item.id), ["month"]);
  assert.deepEqual(
    groupProjectsByActivity(projects, new Date("2026-08-01T12:00:00.000Z"))
      .map((group) => [group.label, group.projects.map((item) => item.id)]),
    [["今天", ["today"]], ["过去 30 天", ["month"]]],
  );
});
