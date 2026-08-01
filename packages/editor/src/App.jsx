import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { groupProgressSteps, mergeProgressStep } from "@/lib/progress";
import "./App.css";

const NEW_KEY = "__new__";

function welcomeMsg() {
  return { role: "system", text: "描述你想要的页面开始生成，例如：做一个深色科技感的 SaaS 定价页" };
}

async function api(path, opts = {}) {
  const res = await fetch(path, opts.body !== undefined ? {
    method: opts.method || "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts.body),
  } : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status}`);
  return data;
}

async function apiStream(path, body, onProgress) {
  const res = await fetch(`${path}${path.includes("?") ? "&" : "?"}stream=1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `${res.status}`);
  }
  if (!res.body) throw new Error("浏览器不支持流式响应");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result;

  const consume = (line) => {
    if (!line.trim()) return;
    const message = JSON.parse(line);
    if (message.type === "progress") onProgress(message.event);
    if (message.type === "result") result = message.data;
    if (message.type === "error") throw new Error(message.error || "Pi 任务失败");
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) consume(line);
    if (done) break;
  }
  consume(buffer);
  if (!result) throw new Error("Pi 任务未返回结果");
  return result;
}

function GenerationPlaceholder({ variantCount }) {
  return (
    <div className="generation-placeholder" aria-live="polite" aria-busy="true">
      <div className="generation-placeholder-head">
        <div className="generation-placeholder-copy">
          <div className="generation-kicker"><Spinner /> 正在构建可运行的 React 页面</div>
          <h2>预览会随着源码生成逐步就绪</h2>
          <p>Pi 正在创建组件、样式和交互，完成构建后这里会自动切换为实时页面。</p>
        </div>
        <Badge variant="outline">{variantCount} 个方案并行生成</Badge>
      </div>
      <div className="browser-skeleton">
        <div className="browser-skeleton-bar">
          <div className="browser-dots"><span /><span /><span /></div>
          <Skeleton className="h-3 w-48" />
          <Skeleton className="h-7 w-20" />
        </div>
        <div className="browser-skeleton-body">
          <div className="browser-skeleton-copy">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-4/5" />
            <Skeleton className="mt-2 h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <div className="browser-skeleton-actions">
              <Skeleton className="h-9 w-28" />
              <Skeleton className="h-9 w-24" />
            </div>
          </div>
          <div className="browser-skeleton-visual">
            <Skeleton className="h-5 w-32" />
            <div className="browser-skeleton-chart">
              <Skeleton className="h-20 w-full" />
              <div className="browser-skeleton-stats">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            </div>
          </div>
          <div className="browser-skeleton-grid">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [drafts, setDrafts] = useState([]);
  const [current, setCurrent] = useState(null);
  const [preview, setPreview] = useState(null);
  const [activeKey, setActiveKey] = useState(NEW_KEY);
  const [chatStore, setChatStore] = useState({ [NEW_KEY]: [welcomeMsg()] });
  const [pickMode, setPickMode] = useState(false);
  const [selected, setSelected] = useState(null);
  const [image, setImage] = useState(null);
  const [sending, setSending] = useState(false);
  const [taskMode, setTaskMode] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [styleId, setStyleId] = useState("__default__");
  const [styles, setStyles] = useState([]);
  const [variants, setVariants] = useState("3");
  const [text, setText] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const previewRef = useRef(null);
  const fileRef = useRef(null);
  const chatEndRef = useRef(null);
  const progressStepsRef = useRef(new Map());

  const messages = useMemo(() => chatStore[activeKey] || [], [chatStore, activeKey]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ block: "end" }); }, [messages]);

  const updateMessages = (key, updater) => {
    setChatStore((prev) => {
      const arr = [...(prev[key] || [])];
      updater(arr);
      return { ...prev, [key]: arr };
    });
  };

  const pushMessage = (msg, key = activeKey) => {
    updateMessages(key, (arr) => arr.push(msg));
    return msg;
  };

  const replaceMessage = (target, next, key = activeKey) => {
    updateMessages(key, (arr) => {
      const idx = target.id ? arr.findIndex((item) => item.id === target.id) : arr.indexOf(target);
      if (idx >= 0) arr[idx] = next;
    });
  };

  const updateProgress = (target, event, key = activeKey) => {
    const steps = mergeProgressStep(progressStepsRef.current.get(target.id) || [], event);
    progressStepsRef.current.set(target.id, steps);
    updateMessages(key, (arr) => {
      const idx = arr.findIndex((item) => item.id === target.id);
      if (idx >= 0) arr[idx] = { ...arr[idx], steps };
    });
  };

  const loadDrafts = async () => {
    try {
      const { drafts: list } = await api("/api/drafts", { method: "GET" });
      setDrafts(list);
    } catch {
      setDrafts([]);
    }
  };

  const loadStyles = async () => {
    try {
      const { templates } = await api("/api/templates", { method: "GET" });
      setStyles(templates);
    } catch {
      setStyles([]);
    }
  };

  const loadDraftIntoView = async (id, version = null) => {
    const data = await api(`/api/drafts/${encodeURIComponent(id)}`, { method: "GET" });
    const nextPreview = await api(`/api/drafts/${encodeURIComponent(id)}/preview`, { body: {} });
    setCurrent(data);
    setPreview(nextPreview);
    setPickMode(false);
    setSelected(null);
    return data;
  };

  const enterDraft = async (id, version = null, { announceLoaded = true } = {}) => {
    const hadChat = (chatStore[id] || []).length > 0;
    setActiveKey(id);
    await loadDraftIntoView(id, version);
    if (announceLoaded && !hadChat) {
      pushMessage({ role: "system", text: "已载入草稿，发送消息继续迭代" }, id);
    }
    setMenuOpen(false);
    await loadDrafts();
  };

  const newDraft = () => {
    setCurrent(null);
    setPreview(null);
    setActiveKey(NEW_KEY);
    setChatStore((prev) => ({ ...prev, [NEW_KEY]: [welcomeMsg()] }));
    setPickMode(false);
    setSelected(null);
    setImage(null);
    setStyleId("__default__");
    setText("");
  };

  const rollbackVersion = async (v) => {
    if (!current) return;
    if (!window.confirm(`确定基于 v${v} 创建一个新的回退版本？历史记录会完整保留。`)) return;
    await api(`/api/drafts/${encodeURIComponent(current.meta.id)}/rollback`, { body: { v } });
    await loadDrafts();
    await enterDraft(current.meta.id, null, { announceLoaded: false });
  };

  const onPreviewLoad = () => {
    const targetOrigin = preview?.url ? new URL(preview.url).origin : "*";
    previewRef.current?.contentWindow?.postMessage({
      type: "draftly:inspect",
      enabled: pickMode,
      token: preview?.token,
    }, targetOrigin);
  };

  const send = async () => {
    const msg = text.trim();
    if (!msg || sending) return;
    if (!current) {
      if (image) {
        window.alert("截图修改需先有草稿，请先生成或选用一个");
        return;
      }
      pushMessage({ role: "user", text: msg });
      const pending = pushMessage({ id: crypto.randomUUID(), role: "assistant", kind: "pending", text: "Pi 正在生成草稿", steps: [] });
      setTaskMode("generate");
      setSending(true);
      try {
        const pickedStyle = styleId === "__default__" ? "" : styleId;
        const { drafts: created } = await apiStream(
          "/api/drafts/generate",
          { prompt: msg, variants: Number(variants), ...(pickedStyle ? { style: pickedStyle } : {}) },
          (event) => updateProgress(pending, event, NEW_KEY),
        );
        const items = created.map((item, i) => ({ ...item, index: i + 1 }));
        const isMulti = items.length > 1;
        const resultText = isMulti ? `✓ 生成 ${items.length} 个方案，点击选用` : `✓ 已生成「${items[0].title}」`;
        const finalSteps = progressStepsRef.current.get(pending.id) || [];
        setChatStore((prev) => {
          const next = { ...prev };
          for (const item of items) {
            next[item.id] = [
              { role: "user", text: msg },
              {
                role: "assistant",
                kind: "generate",
                text: resultText,
                steps: finalSteps,
                variants: isMulti ? items.map((x) => ({ ...x, chosen: x.id === item.id })) : undefined,
              },
            ];
          }
          return next;
        });
        replaceMessage(pending, { role: "assistant", kind: "generate", text: resultText, steps: finalSteps, variants: isMulti ? items.map((x) => ({ ...x, chosen: false })) : undefined });
        setText("");
        await enterDraft(items[0].id, null, { announceLoaded: false });
      } catch (error) {
        replaceMessage(pending, {
          role: "assistant",
          kind: "error",
          text: `✗ 生成失败：${error.message}`,
          steps: progressStepsRef.current.get(pending.id) || [],
        });
      } finally {
        setSending(false);
        setTaskMode(null);
      }
      return;
    }

    const userMsg = { role: "user", text: msg };
    if (image) userMsg.image = image;
    if (selected && !image) userMsg.locator = selected;
    pushMessage(userMsg);
    const pending = pushMessage({
      id: crypto.randomUUID(),
      role: "assistant",
      kind: "pending",
      text: image ? "Pi 正在按截图修改" : selected ? "Pi 正在修改元素" : "Pi 正在迭代草稿",
      steps: [],
    });
    setTaskMode(image ? "image" : selected ? "source" : "iterate");
    setSending(true);
    try {
      let endpoint = `/api/drafts/${encodeURIComponent(current.meta.id)}/iterate`;
      let body = { instruction: msg };
      let okPrefix = "✓ 已迭代";
      if (image) {
        endpoint = `/api/drafts/${encodeURIComponent(current.meta.id)}/edit-by-image`;
        body = { image, instruction: msg };
        okPrefix = "✓ 已按截图修改";
      } else if (selected) {
        endpoint = `/api/drafts/${encodeURIComponent(current.meta.id)}/edit-source`;
        body = { locator: selected, instruction: msg };
        okPrefix = `✓ 已修改 ${selected.component || `<${selected.tagName}>`}`;
      }
      await apiStream(endpoint, body, (event) => updateProgress(pending, event));
      const next = await loadDraftIntoView(current.meta.id);
      replaceMessage(pending, {
        role: "assistant",
        text: `${okPrefix}（v${next.version}）`,
        steps: progressStepsRef.current.get(pending.id) || [],
      });
      setText("");
      setImage(null);
      setSelected(null);
      await loadDrafts();
    } catch (error) {
      replaceMessage(pending, {
        role: "assistant",
        kind: "error",
        text: `✗ 失败：${error.message}`,
        steps: progressStepsRef.current.get(pending.id) || [],
      });
    } finally {
      setSending(false);
      setTaskMode(null);
    }
  };

  useEffect(() => {
    loadStyles();
    loadDrafts();
  }, []);

  useEffect(() => {
    const onPaste = (e) => {
      const items = e.clipboardData?.items || [];
      for (const item of items) {
        if (!item.type.startsWith("image/")) continue;
        const blob = item.getAsFile();
        if (!blob) continue;
        const reader = new FileReader();
        reader.onload = () => setImage(reader.result);
        reader.readAsDataURL(blob);
        e.preventDefault();
        break;
      }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  useEffect(() => {
    if (!preview) return;
    previewRef.current?.contentWindow?.postMessage({
      type: "draftly:inspect",
      enabled: pickMode,
      token: preview.token,
    }, new URL(preview.url).origin);
  }, [pickMode, preview]);

  useEffect(() => {
    const onMessage = (event) => {
      if (event.source !== previewRef.current?.contentWindow) return;
      if (event.data?.type === "draftly:ready") {
        onPreviewLoad();
        return;
      }
      if (event.data?.type !== "draftly:selection" || event.data.token !== preview?.token) return;
      setSelected(event.data.locator);
      const file = encodeURIComponent(event.data.locator.file);
      api(`/api/drafts/${encodeURIComponent(current.meta.id)}/source?file=${file}`, { method: "GET" })
        .then((source) => setCurrent((value) => value ? {
          ...value,
          source: { file: source.file, content: source.source },
        } : value))
        .catch((error) => console.error("Failed to load selected source", error));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [preview, pickMode, current?.meta?.id]);

  const versions = current?.meta?.versions?.slice().reverse() || [];
  const sendingLabel = {
    generate: "生成中",
    image: "按截图修改中",
    source: "修改元素中",
    iterate: "迭代中",
  }[taskMode] || "处理中";

  return (
    <div className="app-root">
      <header id="topbar">
        <div className="brand">draftly <span className="tag">设计草稿</span></div>
        <div className="dropdown">
          <Button variant="outline" disabled={sending} onClick={() => setMenuOpen((v) => !v)}>草稿：{current?.meta?.title || "未选择"} ▾</Button>
          {menuOpen ? (
            <div className="dropdown-menu">
              {!drafts.length ? <div className="dropdown-empty">还没有草稿</div> : drafts.map((d) => (
                <div
                  key={d.id}
                  className={`dropdown-item ${current?.meta?.id === d.id ? "active" : ""}`}
                  onClick={() => d.format === "html-legacy"
                    ? window.alert("这是旧 HTML 草稿，请先运行 npm run migrate:drafts")
                    : enterDraft(d.id)}
                >
                  <div className="di-title">{d.title}</div>
                  <div className="di-sub">
                    {d.format === "html-legacy" ? "待迁移" : `v${d.versions.length}`} · {new Date(d.createdAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <Button disabled={sending} onClick={newDraft}>+ 新草稿</Button>
        <div className="spacer" />
        <Button variant="outline" disabled={!current} onClick={() => setHistoryOpen(true)}>历史</Button>
      </header>

      <main id="layout">
        <section id="preview-pane">
          {current ? (
            <div id="stage-view">
              <div id="stage-bar">
                <div className="stage-meta">
                  <div id="stage-title">{current.meta.title}</div>
                  <div id="stage-sub" className="hint">{current.meta.prompt} · v{current.version}</div>
                </div>
                <div className="stage-actions">
                  <Button variant={pickMode ? "default" : "outline"} onClick={() => setPickMode((v) => !v)}>点选修改</Button>
                  <Button variant="outline" onClick={() => window.open(`/api/drafts/${encodeURIComponent(current.meta.id)}/export`, "_blank")}>导出源码 ZIP</Button>
                  <Button variant="outline" onClick={() => setSourceOpen(true)}>查看源码</Button>
                </div>
              </div>
              <iframe
                ref={previewRef}
                id="preview"
                title="draft preview"
                src={preview?.url}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                onLoad={onPreviewLoad}
              />
            </div>
          ) : sending ? <GenerationPlaceholder variantCount={variants} /> : null}
        </section>

        <aside id="chat-pane">
          <div id="chat-header">
            <span className="chat-header-title">对话</span>
            <span id="chat-header-sub" className="hint">
              {sending ? sendingLabel : current ? `${current.meta.title} · v${current.version}` : ""}
            </span>
          </div>
          <div id="chat-messages">
            {messages.map((m, idx) => (
              <div key={idx} className={`msg-row ${m.role}`}>
                {m.role === "system" ? <div className="msg-system">{m.text}</div> : null}
                {m.role === "user" ? (
                  <div className="bubble">
                    {m.image ? <img className="msg-thumb" src={m.image} alt="参考截图" /> : null}
                    {m.locator ? <div className="msg-tag">🎯 {m.locator.component || m.locator.tagName} · {m.locator.file}:{m.locator.line}</div> : null}
                    {m.text}
                  </div>
                ) : null}
                {m.role === "assistant" ? (
                  <div className={`bubble ${m.kind === "error" ? "bubble-error" : ""}`}>
                    {m.kind === "pending" ? (
                      <div className="task-state">
                        <Spinner />
                        <span>{m.text}</span>
                        <Badge variant="secondary">运行中</Badge>
                      </div>
                    ) : <div>{m.text}</div>}
                    {m.steps?.length ? (
                      <div className="progress-list">
                        {groupProgressSteps(m.steps).map(([variant, steps]) => (
                          <div className="progress-group" key={variant}>
                            {variant ? <div className="progress-group-title">方案 {variant}</div> : null}
                            {steps.filter((step) => !step.parent).map((step) => {
                              const children = steps.filter((child) => child.parent === step.key);
                              return (
                                <div className="progress-phase-block" key={step.key}>
                                  <div className={`progress-step progress-phase ${step.status}`}>
                                    <span className="progress-icon">{step.status === "done" ? "✓" : <span className="progress-dot" />}</span>
                                    <span className="progress-label">{step.label}</span>
                                    {step.detail ? <span className="progress-detail">{step.detail}</span> : null}
                                  </div>
                                  {children.length ? (
                                    <div className="progress-children">
                                      {children.map((child) => (
                                        <div key={child.key} className={`progress-step progress-child ${child.status}`}>
                                          <span className="progress-icon">{child.status === "done" ? "✓" : <span className="progress-dot" />}</span>
                                          <span className="progress-label">{child.label}</span>
                                          {child.detail ? <span className="progress-detail">{child.detail}</span> : null}
                                        </div>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {m.variants?.length ? (
                      <div className="variant-list">
                        {m.variants.map((v) => (
                          <Button key={v.id} variant={v.chosen ? "default" : "outline"} className="variant-card" onClick={() => enterDraft(v.id)}>
                            方案 {v.index} · {v.title}
                          </Button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          <div id="chat-input">
            <div id="chips-row">
              {image ? <Badge variant="secondary">📎 截图已附</Badge> : null}
              {selected ? <Badge variant="outline">🎯 {selected.component || selected.tagName} · {selected.file}:{selected.line}</Badge> : null}
            </div>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="描述你想要的页面，或输入修改指令…（Enter 发送，Shift+Enter 换行）"
              disabled={sending}
              className="chat-textarea"
            />
            <div className="input-row">
              <Button variant="outline" disabled={sending} onClick={() => fileRef.current?.click()}>📎</Button>
              {!current ? (
                <>
                  <Select value={styleId} disabled={sending} onValueChange={setStyleId}>
                    <SelectTrigger className="gen-opt"><SelectValue placeholder="默认风格" /></SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="__default__">默认风格</SelectItem>
                        {styles.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <Select value={variants} disabled={sending} onValueChange={setVariants}>
                    <SelectTrigger className="gen-opt"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="1">1 个方案</SelectItem>
                        <SelectItem value="2">2 个方案</SelectItem>
                        <SelectItem value="3">3 个方案</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </>
              ) : null}
              <Button disabled={sending || !text.trim()} aria-busy={sending} onClick={send}>
                {sending ? <Spinner data-icon="inline-start" /> : null}
                {sending ? sendingLabel : "发送 ↑"}
              </Button>
            </div>
          </div>
        </aside>
      </main>

      <input
        ref={fileRef}
        hidden
        type="file"
        accept="image/*"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => setImage(reader.result);
          reader.readAsDataURL(file);
        }}
      />

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>版本历史</SheetTitle>
          </SheetHeader>
          <div className="version-list">
            {versions.map((ver) => (
              <div key={ver.v} className={`version-item ${ver.v === current?.version ? "active" : ""}`}>
                <div className="version-head">
                  <span>v{ver.v}</span>
                  {ver.v !== current?.version ? <Button size="sm" variant="outline" onClick={() => rollbackVersion(ver.v)}>回退</Button> : null}
                </div>
                <div className="version-sub">{ver.instruction || new Date(ver.at).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={sourceOpen} onOpenChange={setSourceOpen}>
        <DialogContent className="source-dialog">
          <DialogHeader><DialogTitle>React 源码 · {current?.source?.file || "src/App.tsx"}</DialogTitle></DialogHeader>
          <pre id="source-view">{current?.source?.content || "未找到默认入口源码"}</pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}
