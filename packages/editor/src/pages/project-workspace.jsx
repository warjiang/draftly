import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { AppOverlays } from "@/components/app-overlays";
import { ConversationPanel } from "@/components/conversation-panel";
import { MemberDialog } from "@/components/member-dialog";
import { PreviewStage } from "@/components/preview-stage";
import { Button } from "@/components/ui/button";
import { Toaster, toast } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { api, apiStream } from "@/lib/api";
import { mergeProgressStep } from "@/lib/progress";

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

export function ProjectWorkspace({ projectId, user, onSignOut, onNavigate }) {
  const [project, setProject] = useState(null);
  const [drafts, setDrafts] = useState([]);
  const [current, setCurrent] = useState(null);
  const [preview, setPreview] = useState(null);
  const [draftDesign, setDraftDesign] = useState(EMPTY_DESIGN);
  const [stageView, setStageView] = useState("preview");
  const [activeKey, setActiveKey] = useState("");
  const [chatStore, setChatStore] = useState({});
  const [pickMode, setPickMode] = useState(false);
  const [selected, setSelected] = useState(null);
  const [image, setImage] = useState(null);
  const [sending, setSending] = useState(false);
  const [taskMode, setTaskMode] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [rollbackVersion, setRollbackVersion] = useState(null);
  const [text, setText] = useState("");
  const [loadingProject, setLoadingProject] = useState(true);
  const [projectError, setProjectError] = useState("");
  const previewRef = useRef(null);
  const fileRef = useRef(null);
  const chatEndRef = useRef(null);
  const progressStepsRef = useRef(new Map());
  const draftLoadRef = useRef(0);
  const loadedPreviewOriginRef = useRef(null);

  const messages = useMemo(() => chatStore[activeKey] || [], [chatStore, activeKey]);
  const readOnly = project?.role === "viewer";
  const versions = useMemo(() => current?.meta?.versions?.slice().reverse() || [], [current]);
  const sendingLabel = {
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

  const loadDraftIntoView = useCallback(async (id) => {
    const request = ++draftLoadRef.current;
    setDraftDesign({ status: "loading", data: null, error: null });
    const designRequest = api(`/api/drafts/${encodeURIComponent(id)}/design`, { method: "GET" })
      .then((data) => ({ data, error: null }))
      .catch((error) => ({ data: null, error }));
    const [data, nextPreview] = await Promise.all([
      api(`/api/drafts/${encodeURIComponent(id)}`, { method: "GET" }),
      api(`/api/drafts/${encodeURIComponent(id)}/preview`, { body: {} }),
    ]);
    const designResult = await designRequest;
    if (request !== draftLoadRef.current) return null;
    setCurrent(data);
    setPreview(nextPreview);
    setPickMode(false);
    setSelected(null);
    setDraftDesign(designResult.error
      ? { status: "error", data: null, error: designResult.error.message }
      : { status: "ready", data: designResult.data, error: null });
    return { data, request };
  }, []);

  const enterDraft = useCallback(async (id, { announceLoaded = true } = {}) => {
    const hadChat = (chatStore[id] || []).length > 0;
    try {
      const loaded = await loadDraftIntoView(id);
      if (!loaded || loaded.request !== draftLoadRef.current) return;
      setActiveKey(id);
      const updatedProject = readOnly ? project : (await api(`/api/projects/${encodeURIComponent(projectId)}`, {
        method: "PATCH",
        body: { activeDraftId: id },
      })).project;
      if (loaded.request !== draftLoadRef.current) return;
      setProject(updatedProject);
      if (announceLoaded && !hadChat) {
        pushMessage({ role: "system", text: "草稿已载入。描述下一步修改，或开启点选模式精确调整元素。" }, id);
      }
    } catch (error) {
      toast.add({ title: "无法打开方案", description: error.message, type: "error" });
    }
  }, [chatStore, loadDraftIntoView, project, projectId, pushMessage, readOnly]);

  const confirmRollback = useCallback(async () => {
    if (!current || rollbackVersion === null || readOnly) return;
    const version = rollbackVersion;
    setRollbackVersion(null);
    try {
      await api(`/api/drafts/${encodeURIComponent(current.meta.id)}/rollback`, { body: { v: version } });
      await enterDraft(current.meta.id, { announceLoaded: false });
      toast.add({ title: `已基于 v${version} 创建回退版本`, type: "success" });
    } catch (error) {
      toast.add({ title: "回退失败", description: error.message, type: "error" });
    }
  }, [current, enterDraft, readOnly, rollbackVersion]);

  const sendPreviewMessage = useCallback((message, origin = loadedPreviewOriginRef.current) => {
    if (!preview?.url || !origin || origin !== new URL(preview.url).origin) return;
    previewRef.current?.contentWindow?.postMessage(message, origin);
  }, [preview?.url]);

  const onPreviewLoad = useCallback((event) => {
    if (!preview?.url) return;
    const loadedOrigin = new URL(event.currentTarget.src).origin;
    if (loadedOrigin !== new URL(preview.url).origin) return;
    loadedPreviewOriginRef.current = loadedOrigin;
    sendPreviewMessage({
      type: "draftly:inspect",
      enabled: pickMode,
      token: preview?.token,
    }, loadedOrigin);
  }, [pickMode, preview, sendPreviewMessage]);

  const navigatePreview = useCallback((action) => {
    if (action === "reload") {
      const frame = previewRef.current;
      if (frame) frame.src = frame.src;
      return;
    }
    sendPreviewMessage({ type: "draftly:navigate", action });
  }, [sendPreviewMessage]);

  const send = useCallback(async () => {
    const message = text.trim();
    if (!message || sending || readOnly) return;

    if (!current) return;

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
      const loaded = await loadDraftIntoView(current.meta.id);
      if (!loaded) return;
      replaceMessage(pending, {
        role: "assistant",
        text: `${successText}（v${loaded.data.version}）`,
        steps: progressStepsRef.current.get(pending.id) || [],
      });
      setText("");
      setImage(null);
      setSelected(null);
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
    image,
    loadDraftIntoView,
    pushMessage,
    replaceMessage,
    selected,
    sending,
    text,
    updateProgress,
    readOnly,
  ]);

  useEffect(() => {
    let cancelled = false;
    setLoadingProject(true);
    setProjectError("");
    api(`/api/projects/${encodeURIComponent(projectId)}`, { method: "GET" })
      .then(async (data) => {
        if (cancelled) return;
        setProject(data.project);
        setDrafts(data.drafts || []);
        const activeId = data.drafts?.some((draft) => draft.id === data.project.activeDraftId)
          ? data.project.activeDraftId
          : data.drafts?.[0]?.id;
        if (!activeId) throw new Error("项目还没有可用方案");
        setActiveKey(activeId);
        setChatStore((previous) => ({
          ...previous,
          [activeId]: previous[activeId]?.length ? previous[activeId] : [welcomeMessage()],
        }));
        await loadDraftIntoView(activeId);
      })
      .catch((error) => {
        if (!cancelled) setProjectError(error.message);
      })
      .finally(() => {
        if (!cancelled) setLoadingProject(false);
      });
    return () => {
      cancelled = true;
      draftLoadRef.current += 1;
    };
  }, [loadDraftIntoView, projectId]);

  useEffect(() => {
    setStageView("preview");
  }, [current?.meta?.id]);

  const copyDesign = useCallback(async () => {
    const content = draftDesign.data?.content;
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      toast.add({ title: "已复制 DESIGN.md", type: "success" });
    } catch (error) {
      toast.add({ title: "复制失败", description: error.message, type: "error" });
    }
  }, [draftDesign.data?.content]);

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
    sendPreviewMessage({
      type: "draftly:inspect",
      enabled: pickMode,
      token: preview?.token,
    });
  }, [pickMode, preview?.token, sendPreviewMessage]);

  useEffect(() => {
    const onMessage = (event) => {
      if (event.source !== previewRef.current?.contentWindow) return;
      const expectedOrigin = preview?.url ? new URL(preview.url).origin : null;
      if (!expectedOrigin || event.origin !== expectedOrigin) return;
      if (event.data?.type === "draftly:ready") {
        loadedPreviewOriginRef.current = event.origin;
        sendPreviewMessage({
          type: "draftly:inspect",
          enabled: pickMode,
          token: preview?.token,
        }, event.origin);
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
  }, [current?.meta?.id, pickMode, preview?.token, preview?.url, sendPreviewMessage]);

  if (loadingProject || projectError) {
    return (
      <main className="workspace-route-state">
        <span>{loadingProject ? "LOADING PROJECT" : "PROJECT UNAVAILABLE"}</span>
        <h1>{loadingProject ? "正在打开项目工作区" : "无法打开这个项目"}</h1>
        <p>{loadingProject ? "正在恢复方案、预览和设计规范。" : projectError}</p>
        {!loadingProject ? <Button onClick={() => onNavigate("/")}>返回项目首页</Button> : null}
      </main>
    );
  }

  return (
    <TooltipProvider>
      <div className="app-root">
        <AppHeader
          project={project}
          current={current}
          drafts={drafts}
          sending={sending}
          user={user}
          onSignOut={onSignOut}
          onSelectDraft={enterDraft}
          onHome={() => onNavigate("/")}
          onNewProject={() => onNavigate("/")}
          onHistory={() => setHistoryOpen(true)}
          onMembers={() => setMembersOpen(true)}
        />
        <main id="workspace-main" className="workspace-layout">
          <PreviewStage
            current={current}
            preview={preview}
            draftDesign={draftDesign}
            styleDesign={EMPTY_DESIGN}
            styleId="__default__"
            stageView={stageView}
            previewRef={previewRef}
            sending={sending}
            variantCount={String(drafts.length)}
            pickMode={pickMode}
            selected={selected}
            onPreviewLoad={onPreviewLoad}
            onPreviewNavigate={navigatePreview}
            onStageViewChange={setStageView}
            onCopyDesign={copyDesign}
            onRetryStyle={() => {}}
            onTogglePick={() => setPickMode((value) => !value)}
            onOpenSource={() => setSourceOpen(true)}
            onNewDraft={() => onNavigate("/")}
            readOnly={readOnly}
          />
          <ConversationPanel
            current={current}
            messages={messages}
            sending={sending}
            sendingLabel={sendingLabel}
            text={text}
            image={image}
            selected={selected}
            styleId="__default__"
            styles={[]}
            variants="1"
            fileRef={fileRef}
            chatEndRef={chatEndRef}
            onTextChange={setText}
            onStyleChange={() => {}}
            onVariantsChange={() => {}}
            onRemoveImage={() => setImage(null)}
            onRemoveSelected={() => setSelected(null)}
            onSend={send}
            onSelectVariant={enterDraft}
            readOnly={readOnly}
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
          canRollback={!readOnly}
        />
        <MemberDialog projectId={projectId} open={membersOpen} onOpenChange={setMembersOpen} />
        <Toaster />
      </div>
    </TooltipProvider>
  );
}
