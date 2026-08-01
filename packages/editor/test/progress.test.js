import { test } from "node:test";
import assert from "node:assert/strict";
import { groupProgressSteps, mergeProgressStep } from "../src/lib/progress.js";

function apply(events) {
  return events.reduce((steps, event) => mergeProgressStep(steps, event), []);
}

test("progress keeps agent active while nesting and aggregating tool calls", () => {
  const steps = apply([
    { type: "pipeline", stage: "variant_started", variant: 1 },
    { type: "pipeline", stage: "scaffold_started", variant: 1 },
    { type: "pipeline", stage: "scaffold_completed", variant: 1 },
    { type: "pipeline", stage: "dependencies_started", variant: 1 },
    { type: "pipeline", stage: "dependencies_completed", variant: 1 },
    { type: "pipeline", stage: "agent_started", variant: 1 },
    { type: "pi", variant: 1, event: { type: "message_start", role: "assistant" } },
    { type: "pi", variant: 1, event: { type: "tool_execution_start", toolName: "read" } },
    { type: "pi", variant: 1, event: { type: "tool_execution_end", toolName: "read" } },
    { type: "pi", variant: 1, event: { type: "tool_execution_start", toolName: "read" } },
    { type: "pi", variant: 1, event: { type: "tool_execution_end", toolName: "read" } },
    { type: "pi", variant: 1, event: { type: "tool_execution_start", toolName: "read" } },
  ]);

  const agent = steps.find((step) => step.key === "1:agent");
  const reads = steps.filter((step) => step.key === "1:tool:read");
  assert.equal(agent.status, "active");
  assert.equal(reads.length, 1);
  assert.equal(reads[0].parent, "1:agent");
  assert.equal(reads[0].count, 3);
  assert.equal(reads[0].detail, "3 次");
  assert.equal(reads[0].status, "active");
});

test("progress completes semantic phases without leaving active children", () => {
  const steps = apply([
    { type: "pipeline", stage: "variant_started", variant: 1 },
    { type: "pipeline", stage: "scaffold_started", variant: 1 },
    { type: "pipeline", stage: "scaffold_completed", variant: 1 },
    { type: "pipeline", stage: "dependencies_started", variant: 1 },
    { type: "pipeline", stage: "dependencies_completed", variant: 1 },
    { type: "pipeline", stage: "agent_started", variant: 1 },
    { type: "pi", variant: 1, event: { type: "tool_execution_start", toolName: "write" } },
    { type: "pi", variant: 1, event: { type: "tool_execution_end", toolName: "write" } },
    { type: "pipeline", stage: "agent_completed", variant: 1 },
    { type: "pipeline", stage: "validation_started", variant: 1 },
    { type: "pipeline", stage: "validation_completed", variant: 1 },
    { type: "pipeline", stage: "commit_started", variant: 1 },
    { type: "pipeline", stage: "version_saved", variant: 1, version: 1 },
    { type: "pipeline", stage: "variant_completed", variant: 1 },
  ]);

  assert.ok(steps.every((step) => step.status === "done"));
  assert.equal(steps.filter((step) => step.key === "1:tool:write").length, 1);
  assert.equal(steps.find((step) => step.key === "1:commit").detail, "v1");
  assert.equal(groupProgressSteps(steps)[0][0], 1);
});
