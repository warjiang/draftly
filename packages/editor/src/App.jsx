import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { AppOverlays } from "@/components/app-overlays";
import { ConversationPanel } from "@/components/conversation-panel";
import { PreviewStage } from "@/components/preview-stage";
import { Toaster, toast } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { api, apiStream } from "@/lib/api";
import { groupDraftsByProject } from "@/lib/drafts";
import { mergeProgressStep } from "@/lib/progress";
import "./App.css";

const NEW_KEY = "__new__";
const EMPTY_DESIGN = { status: "idle", data: null, error: null };

function welcomeMessage() {
  return {
    id: crypto.randomUUID(),
    role: "system",
    text: "先说清页面要解决什么问题，再补充受众、内容与偏好的视觉气质。",
  };
}

function readImage(file, onLoad) {
  if (!file?.type.startsWith("image/")) return;
  const reader = new FileReader();
  reader.onload = () => onLoad(reader.result);
  reader.readAsDataURL(file);
}

export default function App() {
  const [drafts, setDrafts] = useState([]);
  const [current, setCurrent] = useState(null);
  const [preview, setPreview] = useState(null);
  const [draftDesign, setDraftDesign] = useState(EMPTY_DESIGN);
  const [styleDesign, setStyleDesign] = useState(EMPTY_DESIGN);
  const [stageView, setStageView] = useState("preview");
  const [activeKey, setActiveKey] = useState(NEW_KEY);
  const [chatStore, setChatStore] = useState({ [NEW_KEY]: [welcomeMessage()] });
  const [pickMode, setPickMode] = useState(false);
  const [selected, setSelected] = useState(null);
  const [image, setImage] = useState(null);
  const [sending, setSending] = useState(false);
  const [taskMode, setTaskMode] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [rollbackVersion, setRollbackVersion] = useState(null);
  const [styleId, setStyleId] = useState("__default__");
  const [styleRetry, setStyleRetry] = useState(0);
  const [styles, setStyles] = useState([]);
  const [variants, setVariants] = useState("3");
  const [text, setText] = useState("");
  const previewRef = useRef(null);
  const fileRef = useRef(null);
  const chatEndRef = useRef(null);
  const progressStepsRef = useRef(new Map());
  const styleCacheRef = useRef(new Map());

  const messages = useMemo(() => chatStore[activeKey] || [], [chatStore, activeKey]);
  const draftGroups = useMemo(() => groupDraftsByProject(drafts), [drafts]);
  const versions = useMemo(() => current?.meta?.versions?.slice().reverse() || [], [current]);
  const sendingLabel = {
    generate: "生成中",
    image: "按截图修改中",
    source: "修改元素中",
    iterate: "迭代中",
  }[taskMode] || "处理中";

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages]);

  const updateMessages = useCallback((key, updater) => {
    setChatStore((previous) => {
      const items = [...(previous[key] || [])];
      updater(items);
      return { ...previous, [key]: items };
    });
  }, []);

  const pushMessage = useCallback((message, key = activeKey) => {
    const next = { id: message.id || crypto.randomUUID(), ...message };
    updateMessages(key, (items) => items.push(next));
    return next;
  }, [activeKey, updateMessages]);

  const replaceMessage = useCallback((target, next, key = activeKey) => {
    updateMessages(key, (items) => {
      const index = items.findIndex((item) => item.id === target.id);
      if (index >= 0) items[index] = { id: target.id, ...next };
    });
  }, [activeKey, updateMessages]);

  const updateProgress = useCallback((target, event, key = activeKey) => {
    const steps = mergeProgressStep(progressStepsRef.current.get(target.id) || [], event);
    progressStepsRef.current.set(target.id, steps);
    updateMessages(key, (items) => {
      const index = items.findIndex((item) => item.id === target.id);
      if (index >= 0) items[index] = { ...items[index], steps };
    });
  }, [activeKey, updateMessages]);

  const loadDrafts = useCallback(async ({ quiet = false } = {}) => {
    try {
      const { drafts: list = [] } = await api("/api/drafts", { method: "GET" });
      setDrafts(list);
    } catch (error) {
      setDrafts([]);
      if (!quiet) toast.add({ title: "无法载入草稿", description: error.message, type: "error" });
    }
  }, []);

  const loadStyles = useCallback(async () => {
    try {
      const { templates = [] } = await api("/api/templates", { method: "GET" });
      setStyles(templates);
    } catch (error) {
      setStyles([]);
      toast.add({ title: "无法载入风格预设", description: error.message, type: "error" });
    }
  }, []);

  const loadDraftIntoView = useCallback(async (id) => {
    setDraftDesign({ status: "loading", data: null, error: null });
    const designRequest = api(`/api/drafts/${encodeURIComponent(id)}/design`, { method: "GET" })
      .then((data) => ({ data, error: null }))
      .catch((error) => ({ data: null, error }));
    const [data, nextPreview] = await Promise.all([
      api(`/api/drafts/${encodeURIComponent(id)}`, { method: "GET" }),
      api(`/api/drafts/${encodeURIComponent(id)}/preview`, { body: {} }),
    ]);
    setCurrent(data);
    setPreview(nextPreview);
    setPickMode(false);
    setSelected(null);
    const designResult = await designRequest;
    setDraftDesign(designResult.error
      ? { status: "error", data: null, error: designResult.error.message }
      : { status: "ready", data: designResult.data, error: null });
    return data;
  }, []);

  const enterDraft = useCallback(async (id, { announceLoaded = true } = {}) => {
    const hadChat = (chatStore[id] || []).length > 0;
    setActiveKey(id);
    try {
      await loadDraftIntoView(id);
      if (announceLoaded && !hadChat) {
        pushMessage({ role: "system", text: "草稿已载入。描述下一步修改，或开启点选模式精确调整元素。" }, id);
      }
      await loadDrafts({ quiet: true });
    } catch (error) {
      toast.add({ title: "无法打开草稿", description: error.message, type: "error" });
    }
  }, [chatStore, loadDraftIntoView, loadDrafts, pushMessage]);

  const newDraft = useCallback(() => {
    setCurrent(null);
    setPreview(null);
    setDraftDesign(EMPTY_DESIGN);
    setStyleDesign(EMPTY_DESIGN);
    setStageView("preview");
    setActiveKey(NEW_KEY);
    setChatStore((previous) => ({ ...previous, [NEW_KEY]: [welcomeMessage()] }));
    setPickMode(false);
    setSelected(null);
    setImage(null);
    setStyleId("__default__");
    setText("");
  }, []);

  const confirmRollback = useCallback(async () => {
    if (!current || rollbackVersion === null) return;
    const version = rollbackVersion;
    setRollbackVersion(null);
    try {
      await api(`/api/drafts/${encodeURIComponent(current.meta.id)}/rollback`, { body: { v: version } });
      await loadDrafts({ quiet: true });
      await enterDraft(current.meta.id, { announceLoaded: false });
      toast.add({ title: `已基于 v${version} 创建回退版本`, type: "success" });
    } catch (error) {
      toast.add({ title: "回退失败", description: error.message, type: "error" });
    }
  }, [current, enterDraft, loadDrafts, rollbackVersion]);

  const onPreviewLoad = useCallback(() => {
    const targetOrigin = preview?.url ? new URL(preview.url).origin : "*";
    previewRef.current?.contentWindow?.postMessage({
      type: "draftly:inspect",
      enabled: pickMode,
      token: preview?.token,
    }, targetOrigin);
  }, [pickMode, preview]);

  const send = useCallback(async () => {
    const message = text.trim();
    if (!message || sending) return;

    if (!current) {
      if (image) {
        toast.add({ title: "请先创建或选择草稿", description: "参考截图用于修改已有草稿。", type: "warning" });
        return;
      }
      pushMessage({ role: "user", text: message });
      const pending = pushMessage({ role: "assistant", kind: "pending", text: "Pi 正在生成草稿", steps: [] });
      setTaskMode("generate");
      setSending(true);
      try {
        const pickedStyle = styleId === "__default__" ? "" : styleId;
        const { drafts: created } = await apiStream(
          "/api/drafts/generate",
          { prompt: message, variants: Number(variants), ...(pickedStyle ? { style: pickedStyle } : {}) },
          (event) => updateProgress(pending, event, NEW_KEY),
        );
        const items = created.map((item, index) => ({ ...item, index: index + 1 }));
        const multiple = items.length > 1;
        const resultText = multiple ? `生成了 ${items.length} 个方案，选择一个继续` : `已生成「${items[0].title}」`;
        const finalSteps = progressStepsRef.current.get(pending.id) || [];
        setChatStore((previous) => {
          const next = { ...previous };
          for (const item of items) {
            next[item.id] = [
              { id: crypto.randomUUID(), role: "user", text: message },
              {
                id: crypto.randomUUID(),
                role: "assistant",
                kind: "generate",
                text: resultText,
                steps: finalSteps,
                variants: multiple ? items.map((variant) => ({ ...variant, chosen: variant.id === item.id })) : undefined,
              },
            ];
          }
          return next;
        });
        replaceMessage(pending, {
          role: "assistant",
          kind: "generate",
          text: resultText,
          steps: finalSteps,
          variants: multiple ? items.map((item) => ({ ...item, chosen: false })) : undefined,
        });
        setText("");
        await enterDraft(items[0].id, { announceLoaded: false });
      } catch (error) {
        replaceMessage(pending, {
          role: "assistant",
          kind: "error",
          text: `生成失败：${error.message}`,
          steps: progressStepsRef.current.get(pending.id) || [],
        });
      } finally {
        setSending(false);
        setTaskMode(null);
      }
      return;
    }

    const userMessage = { role: "user", text: message };
    if (image) userMessage.image = image;
    if (selected && !image) userMessage.locator = selected;
    pushMessage(userMessage);
    const pending = pushMessage({
      role: "assistant",
      kind: "pending",
      text: image ? "Pi 正在按截图修改" : selected ? "Pi 正在修改元素" : "Pi 正在迭代草稿",
      steps: [],
    });
    setTaskMode(image ? "image" : selected ? "source" : "iterate");
    setSending(true);
    try {
      let endpoint = `/api/drafts/${encodeURIComponent(current.meta.id)}/iterate`;
      let body = { instruction: message };
      let successText = "已完成迭代";
      if (image) {
        endpoint = `/api/drafts/${encodeURIComponent(current.meta.id)}/edit-by-image`;
        body = { image, instruction: message };
        successText = "已按截图完成修改";
      } else if (selected) {
        endpoint = `/api/drafts/${encodeURIComponent(current.meta.id)}/edit-source`;
        body = { locator: selected, instruction: message };
        successText = `已修改 ${selected.component || `<${selected.tagName}>`}`;
      }
      await apiStream(endpoint, body, (event) => updateProgress(pending, event));
      const next = await loadDraftIntoView(current.meta.id);
      replaceMessage(pending, {
        role: "assistant",
        text: `${successText}（v${next.version}）`,
        steps: progressStepsRef.current.get(pending.id) || [],
      });
      setText("");
      setImage(null);
      setSelected(null);
      await loadDrafts({ quiet: true });
    } catch (error) {
      replaceMessage(pending, {
        role: "assistant",
        kind: "error",
        text: `修改失败：${error.message}`,
        steps: progressStepsRef.current.get(pending.id) || [],
      });
    } finally {
      setSending(false);
      setTaskMode(null);
    }
  }, [
    current,
    enterDraft,
    image,
    loadDraftIntoView,
    loadDrafts,
    pushMessage,
    replaceMessage,
    selected,
    sending,
    styleId,
    text,
    updateProgress,
    variants,
  ]);

  useEffect(() => {
    loadStyles();
    loadDrafts();
  }, [loadDrafts, loadStyles]);

  useEffect(() => {
    setStageView("preview");
  }, [current?.meta?.id, styleId]);

  useEffect(() => {
    if (current || styleId === "__default__") {
      setStyleDesign(EMPTY_DESIGN);
      return undefined;
    }
    const cached = styleCacheRef.current.get(styleId);
    if (cached) {
      setStyleDesign({ status: "ready", data: cached, error: null });
      return undefined;
    }

    const controller = new AbortController();
    setStyleDesign({ status: "loading", data: null, error: null });
    api(`/api/templates/${encodeURIComponent(styleId)}`, {
      method: "GET",
      signal: controller.signal,
    }).then((data) => {
      styleCacheRef.current.set(styleId, data);
      setStyleDesign({ status: "ready", data, error: null });
    }).catch((error) => {
      if (error.name === "AbortError") return;
      setStyleDesign({ status: "error", data: null, error: error.message });
    });
    return () => controller.abort();
  }, [current, styleId, styleRetry]);

  const copyDesign = useCallback(async () => {
    const content = current ? draftDesign.data?.content : styleDesign.data?.designMd;
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      toast.add({ title: "已复制 DESIGN.md", type: "success" });
    } catch (error) {
      toast.add({ title: "复制失败", description: error.message, type: "error" });
    }
  }, [current, draftDesign.data?.content, styleDesign.data?.designMd]);

  useEffect(() => {
    const onPaste = (event) => {
      const item = [...(event.clipboardData?.items || [])].find((candidate) => candidate.type.startsWith("image/"));
      if (!item) return;
      if (!current) {
        toast.add({ title: "请先创建或选择草稿", description: "截图可作为已有草稿的修改参考。", type: "warning" });
        return;
      }
      readImage(item.getAsFile(), setImage);
      event.preventDefault();
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [current]);

  useEffect(() => {
    if (!preview) return;
    onPreviewLoad();
  }, [onPreviewLoad, preview]);

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
        .catch((error) => toast.add({ title: "无法载入所选源码", description: error.message, type: "error" }));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [current?.meta?.id, onPreviewLoad, preview?.token]);

  return (
    <TooltipProvider>
      <div className="app-root">
        <AppHeader
          current={current}
          draftGroups={draftGroups}
          sending={sending}
          onSelectDraft={enterDraft}
          onNewDraft={newDraft}
          onHistory={() => setHistoryOpen(true)}
          onLegacyDraft={() => toast.add({
            title: "这是旧版 HTML 草稿",
            description: "请先运行 npm run migrate:drafts 完成迁移。",
            type: "warning",
          })}
        />
        <main id="workspace-main" className="workspace-layout">
          <PreviewStage
            current={current}
            preview={preview}
            draftDesign={draftDesign}
            styleDesign={styleDesign}
            styleId={styleId}
            stageView={stageView}
            previewRef={previewRef}
            sending={sending}
            variantCount={variants}
            pickMode={pickMode}
            selected={selected}
            onPreviewLoad={onPreviewLoad}
            onStageViewChange={setStageView}
            onCopyDesign={copyDesign}
            onRetryStyle={() => setStyleRetry((value) => value + 1)}
            onTogglePick={() => setPickMode((value) => !value)}
            onOpenSource={() => setSourceOpen(true)}
            onNewDraft={newDraft}
          />
          <ConversationPanel
            current={current}
            messages={messages}
            sending={sending}
            sendingLabel={sendingLabel}
            text={text}
            image={image}
            selected={selected}
            styleId={styleId}
            styles={styles}
            variants={variants}
            fileRef={fileRef}
            chatEndRef={chatEndRef}
            onTextChange={setText}
            onStyleChange={setStyleId}
            onVariantsChange={setVariants}
            onRemoveImage={() => setImage(null)}
            onRemoveSelected={() => setSelected(null)}
            onSend={send}
            onSelectVariant={enterDraft}
          />
        </main>

        <input
          ref={fileRef}
          hidden
          type="file"
          accept="image/*"
          onChange={(event) => {
            readImage(event.target.files?.[0], setImage);
            event.target.value = "";
          }}
        />

        <AppOverlays
          current={current}
          versions={versions}
          historyOpen={historyOpen}
          sourceOpen={sourceOpen}
          rollbackVersion={rollbackVersion}
          onHistoryChange={setHistoryOpen}
          onSourceChange={setSourceOpen}
          onRollbackRequest={setRollbackVersion}
          onRollbackCancel={() => setRollbackVersion(null)}
          onRollbackConfirm={confirmRollback}
        />
        <Toaster />
      </div>
    </TooltipProvider>
  );
}
