import { test } from "node:test";
import assert from "node:assert/strict";
import { groupProgressSteps, mergeProgressStep } from "../src/lib/progress.js";

function apply(events) {
  return events.reduce((steps, event) => mergeProgressStep(steps, event), []);
}

test("progress lists each tool call as its own trace line with a target", () => {
  const steps = apply([
    { type: "pipeline", stage: "variant_started", variant: 1 },
    { type: "pipeline", stage: "scaffold_started", variant: 1 },
    { type: "pipeline", stage: "scaffold_completed", variant: 1 },
    { type: "pipeline", stage: "dependencies_started", variant: 1 },
    { type: "pipeline", stage: "dependencies_completed", variant: 1 },
    { type: "pipeline", stage: "agent_started", variant: 1 },
    { type: "pi", variant: 1, event: { type: "message_start", role: "assistant" } },
    { type: "pi", variant: 1, event: { type: "tool_execution_start", toolName: "read", toolCallId: "r1", toolSummary: "button.tsx" } },
    { type: "pi", variant: 1, event: { type: "tool_execution_end", toolName: "read", toolCallId: "r1" } },
    { type: "pi", variant: 1, event: { type: "tool_execution_start", toolName: "read", toolCallId: "r2", toolSummary: "card.tsx" } },
    { type: "pi", variant: 1, event: { type: "tool_execution_end", toolName: "read", toolCallId: "r2" } },
    { type: "pi", variant: 1, event: { type: "tool_execution_start", toolName: "bash", toolCallId: "b1", toolSummary: "npm run build" } },
  ]);

  const agent = steps.find((step) => step.key === "1:agent");
  const calls = steps.filter((step) => step.parent === "1:agent" && step.kind === "child" && step.tool);
  assert.equal(agent.status, "active");
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map((step) => step.label), ["读取文件", "读取文件", "运行命令"]);
  assert.deepEqual(calls.map((step) => step.detail), ["button.tsx", "card.tsx", "npm run build"]);
  assert.equal(calls[0].status, "done");
  assert.equal(calls[1].status, "done");
  assert.equal(calls[2].status, "active");
});

test("progress completes semantic phases without leaving active children", () => {
  const steps = apply([
    { type: "pipeline", stage: "variant_started", variant: 1 },
    { type: "pipeline", stage: "scaffold_started", variant: 1 },
    { type: "pipeline", stage: "scaffold_completed", variant: 1 },
    { type: "pipeline", stage: "dependencies_started", variant: 1 },
    { type: "pipeline", stage: "dependencies_completed", variant: 1 },
    { type: "pipeline", stage: "agent_started", variant: 1 },
    { type: "pi", variant: 1, event: { type: "tool_execution_start", toolName: "write", toolCallId: "w1" } },
    { type: "pi", variant: 1, event: { type: "tool_execution_end", toolName: "write", toolCallId: "w1" } },
    { type: "pipeline", stage: "agent_completed", variant: 1 },
    { type: "pipeline", stage: "validation_started", variant: 1 },
    { type: "pipeline", stage: "validation_completed", variant: 1 },
    { type: "pipeline", stage: "commit_started", variant: 1 },
    { type: "pipeline", stage: "version_saved", variant: 1, version: 1 },
    { type: "pipeline", stage: "variant_completed", variant: 1 },
  ]);

  assert.ok(steps.every((step) => step.status === "done"));
  assert.equal(steps.filter((step) => step.key === "1:call:w1").length, 1);
  assert.equal(steps.find((step) => step.key === "1:commit").detail, "v1");
  assert.equal(groupProgressSteps(steps)[0][0], 1);
});
