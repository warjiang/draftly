const PIPELINE_STAGES = {
  variant_started: { key: "prepare", label: "准备生成方案", action: "start" },
  scaffold_started: { key: "scaffold", label: "创建 React 源码工程", action: "start" },
  scaffold_completed: { key: "scaffold", label: "React 源码工程已创建", action: "complete" },
  dependencies_started: { key: "dependencies", label: "安装项目依赖", action: "start" },
  dependencies_completed: { key: "dependencies", label: "项目依赖已就绪", action: "complete" },
  context_loaded: { key: "context", label: "读取当前草稿", action: "instant" },
  source_located: { key: "context", label: "定位 React 源码", action: "instant" },
  image_prepared: { key: "context", label: "准备参考截图", action: "instant" },
  agent_started: { key: "agent", label: "Pi 生成源码", action: "start" },
  agent_completed: { key: "agent", label: "Pi 源码修改完成", action: "complete" },
  validation_started: { key: "validation", label: "构建并校验项目", action: "start" },
  validation_completed: { key: "validation", label: "项目构建通过", action: "complete" },
  commit_started: { key: "commit", label: "提交 Git 版本", action: "start" },
  rollback_started: { key: "rollback", label: "恢复目标源码版本", action: "start" },
};

const TOOL_LABELS = {
  bash: "运行命令",
  read: "读取文件",
  write: "写入文件",
  edit: "编辑源码",
};

export function mergeProgressStep(steps, payload) {
  const variantId = payload.variant || 0;
  const prefix = `${variantId}:`;
  const fullKey = (key) => `${prefix}${key}`;

  const upsert = (items, key, values) => {
    const keyWithPrefix = fullKey(key);
    const next = [...items];
    const index = next.findIndex((item) => item.key === keyWithPrefix);
    const existing = index >= 0 ? next[index] : null;
    const step = {
      key: keyWithPrefix,
      variant: variantId,
      status: "active",
      ...existing,
      ...values,
    };
    if (index >= 0) next[index] = step;
    else next.push(step);
    return next;
  };

  const complete = (items, key, values = {}) => items.map((item) =>
    item.key === fullKey(key) ? { ...item, ...values, status: "done" } : item);

  const completeVariant = (items) => items.map((item) =>
    item.key.startsWith(prefix) && item.status === "active" ? { ...item, status: "done" } : item);

  const startPhase = (items, key, label, detail = "") => {
    const completed = completeVariant(items);
    return upsert(completed, key, { label, detail, kind: "phase", parent: null, status: "active" });
  };

  const completePhase = (items, key, label, detail = "") => {
    const parent = fullKey(key);
    const completed = items.map((item) =>
      item.parent === parent && item.status === "active" ? { ...item, status: "done" } : item);
    const withPhase = upsert(completed, key, {
      label,
      detail,
      kind: "phase",
      parent: null,
      status: "done",
    });
    return complete(withPhase, key, { label, detail });
  };

  const startChild = (items, parentKey, key, label, detail = "", count = 0) => {
    const parent = fullKey(parentKey);
    const completed = items.map((item) =>
      item.parent === parent && item.status === "active" ? { ...item, status: "done" } : item);
    return upsert(completed, key, {
      label,
      detail,
      count,
      kind: "child",
      parent,
      status: "active",
    });
  };

  if (payload.type === "pipeline") {
    if (payload.stage === "version_saved") {
      const activePhase = steps.find((item) =>
        item.key.startsWith(prefix) && item.kind === "phase" && item.status === "active");
      const key = activePhase?.key.slice(prefix.length) || "commit";
      return completePhase(
        steps,
        key,
        key === "rollback" ? "源码回退已提交" : "Git 版本已提交",
        `v${payload.version}`,
      );
    }
    if (payload.stage === "variant_completed") return completeVariant(steps);
    const stage = PIPELINE_STAGES[payload.stage];
    if (!stage) return steps;
    const detail = payload.file
      ? `${payload.component || ""} ${payload.file}:${payload.line || ""}`.trim()
      : "";
    if (stage.action === "start") return startPhase(steps, stage.key, stage.label, detail);
    if (stage.action === "complete") return completePhase(steps, stage.key, stage.label, detail);
    return completePhase(startPhase(steps, stage.key, stage.label, detail), stage.key, stage.label, detail);
  }

  const event = payload.event || {};
  const updateType = event.assistantMessageEvent?.type;
  if (event.type === "agent_start") return steps;
  if (event.type === "message_start" && event.role === "assistant") {
    return startChild(steps, "agent", "model", "请求模型响应");
  }
  if (updateType === "thinking_start" || updateType === "thinking_delta") {
    return startChild(steps, "agent", "reasoning", "分析页面需求");
  }
  if (updateType === "text_start" || updateType === "text_delta") {
    const existing = steps.find((item) => item.key === fullKey("output"));
    const count = (existing?.count || 0) + (event.assistantMessageEvent?.deltaLength || 0);
    return startChild(steps, "agent", "output", "整理任务结果", `${count} 字符`, count);
  }
  if (event.type === "tool_execution_start") {
    const toolName = event.toolName || "tool";
    const key = `tool:${toolName}`;
    const existing = steps.find((item) => item.key === fullKey(key));
    const count = (existing?.count || 0) + 1;
    return startChild(
      steps,
      "agent",
      key,
      TOOL_LABELS[toolName] || `执行 ${toolName}`,
      count > 1 ? `${count} 次` : "",
      count,
    );
  }
  if (event.type === "tool_execution_end") {
    return complete(steps, `tool:${event.toolName || "tool"}`);
  }
  if (event.type === "agent_end" || event.type === "agent_settled") {
    return steps.map((item) =>
      item.parent === fullKey("agent") && item.status === "active" ? { ...item, status: "done" } : item);
  }
  return steps;
}

export function groupProgressSteps(steps) {
  const groups = new Map();
  for (const step of steps) {
    const variant = step.variant || 0;
    if (!groups.has(variant)) groups.set(variant, []);
    groups.get(variant).push(step);
  }
  return [...groups.entries()].sort(([a], [b]) => a - b);
}
