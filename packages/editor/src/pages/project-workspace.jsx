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
import {
  buildStyleEditPayload,
  sameAnnotation,
  selectionHasStyleEdits,
} from "@/lib/annotations";

const EMPTY_DESIGN = { status: "idle", data: null, error: null };

function welcomeMessage() {
  return {
    id: crypto.randomUUID(),
    role: "system",
    dismissible: true,
    text: "先说清页面要解决什么问题，再补充受众、内容与偏好的视觉气质。",
  };
}

const NEW_PREFIX = "new:";
const newConversationKey = (draftId) => `${NEW_PREFIX}${draftId}`;
const isNewKey = (key) => typeof key === "string" && key.startsWith(NEW_PREFIX);

function deriveConversationTitle(message, selected) {
  const text = String(message || "").replace(/\s+/g, " ").trim();
  if (text) return text.slice(0, 40);
  const first = selected?.[0];
  if (first) return `修改 ${first.component || `<${first.tagName}>`}`;
  return "新会话";
}

// Only durable fields belong in server history; drop transient render state.
function sanitizeMessage(message) {
  const { seq, createdAt, ...rest } = message;
  void seq;
  void createdAt;
  return rest;
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
  const [designView, setDesignView] = useState("system");
  const [activeKey, setActiveKey] = useState("");
  const [chatStore, setChatStore] = useState({});
  const [conversationList, setConversationList] = useState([]);
  const [pickMode, setPickMode] = useState(false);
  const [selected, setSelected] = useState([]);
  const [activeAnnotation, setActiveAnnotation] = useState(null);
  const [image, setImage] = useState(null);
  const [sending, setSending] = useState(false);
  const [taskMode, setTaskMode] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [rollbackVersion, setRollbackVersion] = useState(null);
  const [text, setText] = useState("");
  const [piModels, setPiModels] = useState([]);
  const [piDefaults, setPiDefaults] = useState({});
  // Session-only pi overrides; "__default__" means follow the server config.
  const [piModel, setPiModel] = useState("__default__");
  const [piThinking, setPiThinking] = useState("__default__");
  const [loadingProject, setLoadingProject] = useState(true);
  const [projectError, setProjectError] = useState("");
  const [chatWidth, setChatWidth] = useState(() => {
    const stored = Number(localStorage.getItem("draftly:chat-width"));
    return Number.isFinite(stored) && stored >= 320 && stored <= 720 ? stored : 332;
  });
  const previewRef = useRef(null);
  const fileRef = useRef(null);
  const chatEndRef = useRef(null);
  const progressStepsRef = useRef(new Map());
  const draftLoadRef = useRef(0);
  const loadedPreviewOriginRef = useRef(null);

  const messages = useMemo(() => chatStore[activeKey] || [], [chatStore, activeKey]);  const readOnly = project?.role === "viewer";
  const versions = useMemo(() => current?.meta?.versions?.slice().reverse() || [], [current]);
  const sendingLabel = {
    image: "按截图修改中",
    source: "修改元素中",
    iterate: "迭代中",
    style: "应用样式中",
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

  const dismissMessage = useCallback((target, key = activeKey) => {
    updateMessages(key, (items) => {
      const index = items.findIndex((item) => item.id === target.id);
      if (index >= 0) items.splice(index, 1);
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

  const loadConversations = useCallback(async (draftId) => {
    try {
      const { conversations } = await api(
        `/api/drafts/${encodeURIComponent(draftId)}/conversations`,
        { method: "GET" },
      );
      return conversations || [];
    } catch {
      return [];
    }
  }, []);

  const openConversation = useCallback(async (draftId, conversationId) => {
    let loaded = [];
    try {
      const { messages: history } = await api(
        `/api/drafts/${encodeURIComponent(draftId)}/conversations/${encodeURIComponent(conversationId)}/messages`,
        { method: "GET" },
      );
      loaded = history || [];
    } catch (error) {
      toast.add({ title: "无法载入会话记录", description: error.message, type: "error" });
    }
    progressStepsRef.current.clear();
    setChatStore((previous) => ({
      ...previous,
      [conversationId]: loaded.length ? loaded : [welcomeMessage()],
    }));
    setActiveKey(conversationId);
  }, []);

  const bootstrapConversations = useCallback(async (draftId) => {
    const list = await loadConversations(draftId);
    setConversationList(list);
    if (list.length) {
      await openConversation(draftId, list[0].id);
    } else {
      const key = newConversationKey(draftId);
      setChatStore((previous) => ({
        ...previous,
        [key]: previous[key]?.length ? previous[key] : [welcomeMessage()],
      }));
      setActiveKey(key);
    }
  }, [loadConversations, openConversation]);

  const persistMessage = useCallback((draftId, conversationId, message) => {
    if (!conversationId || isNewKey(conversationId)) return Promise.resolve(null);
    return api(
      `/api/drafts/${encodeURIComponent(draftId)}/conversations/${encodeURIComponent(conversationId)}/messages`,
      { body: { role: message.role, data: sanitizeMessage(message) } },
    ).catch(() => null);
  }, []);

  const ensureConversation = useCallback(async (draftId, title) => {
    if (activeKey && !isNewKey(activeKey)) return activeKey;
    const { conversation } = await api(
      `/api/drafts/${encodeURIComponent(draftId)}/conversations`,
      { body: { title } },
    );
    const placeholderKey = newConversationKey(draftId);
    setConversationList((previous) => [conversation, ...previous.filter((item) => item.id !== conversation.id)]);
    setChatStore((previous) => {
      const carried = (previous[placeholderKey] || []).filter((item) => item.role !== "system");
      const next = { ...previous };
      delete next[placeholderKey];
      next[conversation.id] = carried;
      return next;
    });
    setActiveKey(conversation.id);
    return conversation.id;
  }, [activeKey]);

  const refreshConversationList = useCallback((draftId) => {
    loadConversations(draftId).then(setConversationList);
  }, [loadConversations]);

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
    // The preview proxy can't forward Vite's HMR websocket, so file edits made
    // by a task never push a reload on their own. Bump a nonce on the preview
    // URL every load so React swaps the iframe src and the frame fully reloads,
    // showing the freshly modified page.
    const previewUrl = new URL(nextPreview.url, window.location.origin);
    previewUrl.searchParams.set("r", Date.now().toString(36));
    setPreview({
      ...nextPreview,
      url: previewUrl.toString(),
    });
    setPickMode(false);
    setSelected([]);
    setActiveAnnotation(null);
    setDraftDesign(designResult.error
      ? { status: "error", data: null, error: designResult.error.message }
      : { status: "ready", data: designResult.data, error: null });
    return { data, request };
  }, []);

  const enterDraft = useCallback(async (id, { announceLoaded = true } = {}) => {
    void announceLoaded;
    try {
      const loaded = await loadDraftIntoView(id);
      if (!loaded || loaded.request !== draftLoadRef.current) return;
      setActiveKey("");
      const updatedProject = readOnly ? project : (await api(`/api/projects/${encodeURIComponent(projectId)}`, {
        method: "PATCH",
        body: { activeDraftId: id },
      })).project;
      if (loaded.request !== draftLoadRef.current) return;
      setProject(updatedProject);
      await bootstrapConversations(id);
    } catch (error) {
      toast.add({ title: "无法打开方案", description: error.message, type: "error" });
    }
  }, [bootstrapConversations, loadDraftIntoView, project, projectId, readOnly]);

  const renameProject = useCallback(async (nextTitle) => {
    const title = String(nextTitle || "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (readOnly || !title || title === project?.title) return;
    const previous = project;
    setProject((current) => (current ? { ...current, title } : current));
    try {
      const { project: updated } = await api(`/api/projects/${encodeURIComponent(projectId)}`, {
        method: "PATCH",
        body: { title },
      });
      setProject(updated);
    } catch (error) {
      setProject(previous);
      toast.add({ title: "重命名失败", description: error.message, type: "error" });
    }
  }, [project, projectId, readOnly]);

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
    const hasSelection = selected?.length > 0 && !image;
    const hasComments = hasSelection && selected.some((item) => item.comment?.trim());
    if ((!message && !hasComments) || sending || readOnly) return;

    if (!current) return;
    const draftId = current.meta.id;

    let cid;
    try {
      cid = await ensureConversation(draftId, deriveConversationTitle(message, selected));
    } catch (error) {
      toast.add({ title: "无法创建会话", description: error.message, type: "error" });
      return;
    }

    const displayText = message;
    const userMessage = { id: crypto.randomUUID(), role: "user", text: displayText };
    if (image) userMessage.image = image;
    if (hasSelection) userMessage.locators = selected;
    pushMessage(userMessage, cid);
    persistMessage(draftId, cid, userMessage);
    const pending = pushMessage({
      role: "assistant",
      kind: "pending",
      text: image ? "Pi 正在按截图修改" : hasSelection ? "Pi 正在修改元素" : "Pi 正在迭代草稿",
      steps: [],
    }, cid);
    setTaskMode(image ? "image" : hasSelection ? "source" : "iterate");
    if (hasSelection) {
      setPickMode(false);
      setSelected([]);
      setActiveAnnotation(null);
      sendPreviewMessage({ type: "draftly:clear-selection" });
    }
    setSending(true);
    try {
      let endpoint = `/api/drafts/${encodeURIComponent(current.meta.id)}/iterate`;
      let body = { instruction: message };
      let successText = "已完成迭代";
      if (image) {
        endpoint = `/api/drafts/${encodeURIComponent(current.meta.id)}/edit-by-image`;
        body = { image, instruction: message };
        successText = "已按截图完成修改";
      } else if (hasSelection) {
        endpoint = `/api/drafts/${encodeURIComponent(current.meta.id)}/edit-source`;
        body = { locators: selected, instruction: message };
        const first = selected[0];
        successText =
          selected.length > 1
            ? `已修改 ${selected.length} 个元素`
            : `已修改 ${first.component || `<${first.tagName}>`}`;
      }
      if (piModel !== "__default__") {
        const [provider, model] = piModel.split("::");
        if (provider && model) {
          body.provider = provider;
          body.model = model;
        }
      }
      if (piThinking !== "__default__") body.thinking = piThinking;
      await apiStream(endpoint, body, (event) => updateProgress(pending, event, cid));
      const loaded = await loadDraftIntoView(current.meta.id);
      if (!loaded) return;
      const finalMessage = {
        id: pending.id,
        role: "assistant",
        text: `${successText}（v${loaded.data.version}）`,
        steps: progressStepsRef.current.get(pending.id) || [],
      };
      replaceMessage(pending, finalMessage, cid);
      persistMessage(draftId, cid, finalMessage);
      refreshConversationList(draftId);
      setText("");
      setImage(null);
      setSelected([]);
      setActiveAnnotation(null);
      sendPreviewMessage({ type: "draftly:clear-selection" });
    } catch (error) {
      const errorMessage = {
        id: pending.id,
        role: "assistant",
        kind: "error",
        text: `修改失败：${error.message}`,
        steps: progressStepsRef.current.get(pending.id) || [],
      };
      replaceMessage(pending, errorMessage, cid);
      persistMessage(draftId, cid, errorMessage);
      refreshConversationList(draftId);
    } finally {
      setSending(false);
      setTaskMode(null);
    }
  }, [
    current,
    ensureConversation,
    image,
    loadDraftIntoView,
    persistMessage,
    piModel,
    piThinking,
    pushMessage,
    refreshConversationList,
    replaceMessage,
    selected,
    sending,
    sendPreviewMessage,
    text,
    updateProgress,
    readOnly,
  ]);

  useEffect(() => {
    let cancelled = false;
    api("/api/pi/models")
      .then((data) => {
        if (cancelled) return;
        setPiModels(Array.isArray(data.models) ? data.models : []);
        setPiDefaults(data.defaults || {});
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

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
        await loadDraftIntoView(activeId);
        if (cancelled) return;
        await bootstrapConversations(activeId);
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
  }, [bootstrapConversations, loadDraftIntoView, projectId]);

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

  const copyDesignValue = useCallback(async (value) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.add({ title: `已复制 ${value}`, type: "success" });
    } catch (error) {
      toast.add({ title: "复制失败", description: error.message, type: "error" });
    }
  }, [toast]);

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

  const cancelPick = useCallback(() => {
    let handled = false;
    setSelected((value) => {
      if (value?.length) handled = true;
      return [];
    });
    setActiveAnnotation(null);
    setPickMode((value) => {
      if (!handled && value) handled = true;
      return false;
    });
    sendPreviewMessage({ type: "draftly:clear-selection" });
    return handled;
  }, [sendPreviewMessage]);

  const exitPick = useCallback(() => {
    // Leave annotation mode: close the inspect card + turn off picking, but keep
    // already-confirmed elements queued in the list. Only the in-progress draft
    // (if any) is discarded in the preview.
    let handled = false;
    setPickMode((value) => {
      if (value) handled = true;
      return false;
    });
    setActiveAnnotation(null);
    sendPreviewMessage({ type: "draftly:discard-drafts" });
    return handled;
  }, [sendPreviewMessage]);

  const deselectOne = useCallback((locator) => {
    setSelected((value) => (value || []).filter((item) => !sameAnnotation(item, locator)));
    setActiveAnnotation((value) => (sameAnnotation(value, locator) ? null : value));
    sendPreviewMessage({
      type: "draftly:deselect",
      uid: locator.uid,
      file: locator.file,
      line: locator.line,
      column: locator.column,
    });
  }, [sendPreviewMessage]);

  const focusAnnotation = useCallback((locator) => {
    setActiveAnnotation(locator);
    sendPreviewMessage({
      type: "draftly:set-active",
      uid: locator.uid,
      file: locator.file,
      line: locator.line,
      column: locator.column,
    });
  }, [sendPreviewMessage]);

  const updateSelectedComment = useCallback((locator, comment) => {
    setSelected((value) =>
      (value || []).map((item) => (sameAnnotation(item, locator) ? { ...item, comment } : item)));
    setActiveAnnotation((value) => (sameAnnotation(value, locator) ? { ...value, comment } : value));
    sendPreviewMessage({
      type: "draftly:update-annotation",
      uid: locator.uid,
      file: locator.file,
      line: locator.line,
      column: locator.column,
      comment,
    });
  }, [sendPreviewMessage]);

  const applyStyleEdits = useCallback(async () => {
    if (!current || readOnly || sending) return;
    const edits = buildStyleEditPayload(selected);
    if (!edits.length) return;
    const draftId = current.meta.id;
    let cid;
    try {
      cid = await ensureConversation(draftId, deriveConversationTitle("", selected));
    } catch (error) {
      toast.add({ title: "无法创建会话", description: error.message, type: "error" });
      return;
    }
    const pending = pushMessage({
      role: "assistant",
      kind: "pending",
      text: "正在应用样式修改",
      steps: [],
    }, cid);
    setTaskMode("style");
    setSending(true);
    setPickMode(false);
    setSelected([]);
    setActiveAnnotation(null);
    sendPreviewMessage({ type: "draftly:clear-selection" });
    try {
      const result = await apiStream(
        `/api/drafts/${encodeURIComponent(current.meta.id)}/apply-style`,
        { edits },
        (event) => updateProgress(pending, event, cid),
      );
      const loaded = await loadDraftIntoView(current.meta.id);
      const version = loaded?.data.version ?? result?.version;
      const finalMessage = {
        id: pending.id,
        role: "assistant",
        text: `已应用样式修改（v${version}）`,
        steps: progressStepsRef.current.get(pending.id) || [],
      };
      replaceMessage(pending, finalMessage, cid);
      persistMessage(draftId, cid, finalMessage);
      refreshConversationList(draftId);
    } catch (error) {
      const errorMessage = {
        id: pending.id,
        role: "assistant",
        kind: "error",
        text: `样式修改失败：${error.message}`,
        steps: progressStepsRef.current.get(pending.id) || [],
      };
      replaceMessage(pending, errorMessage, cid);
      persistMessage(draftId, cid, errorMessage);
      refreshConversationList(draftId);
    } finally {
      setSending(false);
      setTaskMode(null);
    }
  }, [
    current,
    ensureConversation,
    loadDraftIntoView,
    persistMessage,
    pushMessage,
    readOnly,
    refreshConversationList,
    replaceMessage,
    selected,
    sending,
    sendPreviewMessage,
    updateProgress,
  ]);

  const selectConversation = useCallback(async (conversationId) => {
    if (!current || conversationId === activeKey || sending) return;
    await openConversation(current.meta.id, conversationId);
  }, [activeKey, current, openConversation, sending]);

  const newConversation = useCallback(() => {
    if (!current || sending) return;
    const key = newConversationKey(current.meta.id);
    progressStepsRef.current.clear();
    setChatStore((previous) => ({ ...previous, [key]: [welcomeMessage()] }));
    setActiveKey(key);
  }, [current, sending]);

  const renameConversation = useCallback(async (conversationId, title) => {
    if (!current) return;
    const clean = String(title || "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (!clean) return;
    setConversationList((previous) =>
      previous.map((item) => (item.id === conversationId ? { ...item, title: clean } : item)));
    try {
      await api(
        `/api/drafts/${encodeURIComponent(current.meta.id)}/conversations/${encodeURIComponent(conversationId)}`,
        { method: "PATCH", body: { title: clean } },
      );
    } catch (error) {
      toast.add({ title: "重命名失败", description: error.message, type: "error" });
      refreshConversationList(current.meta.id);
    }
  }, [current, refreshConversationList]);

  const deleteConversation = useCallback(async (conversationId) => {
    if (!current) return;
    const draftId = current.meta.id;
    try {
      await api(
        `/api/drafts/${encodeURIComponent(draftId)}/conversations/${encodeURIComponent(conversationId)}`,
        { method: "DELETE" },
      );
    } catch (error) {
      toast.add({ title: "删除会话失败", description: error.message, type: "error" });
      return;
    }
    setChatStore((previous) => {
      const next = { ...previous };
      delete next[conversationId];
      return next;
    });
    const remaining = conversationList.filter((item) => item.id !== conversationId);
    setConversationList(remaining);
    if (activeKey === conversationId) {
      if (remaining.length) {
        await openConversation(draftId, remaining[0].id);
      } else {
        const key = newConversationKey(draftId);
        setChatStore((previous) => ({ ...previous, [key]: [welcomeMessage()] }));
        setActiveKey(key);
      }
    }
  }, [activeKey, conversationList, current, openConversation]);

  const startChatResize = useCallback((event) => {
    event.preventDefault();
    const onMove = (moveEvent) => {
      const next = Math.min(720, Math.max(320, window.innerWidth - moveEvent.clientX));
      setChatWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.classList.remove("is-resizing-chat");
    };
    document.body.classList.add("is-resizing-chat");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  useEffect(() => {
    localStorage.setItem("draftly:chat-width", String(chatWidth));
  }, [chatWidth]);

  useEffect(() => {
    if (historyOpen || membersOpen || rollbackVersion !== null) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (exitPick()) event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [exitPick, historyOpen, membersOpen, rollbackVersion]);

  useEffect(() => {
    const onMessage = (event) => {
      if (event.source !== previewRef.current?.contentWindow) return;
      if (event.data?.type !== "draftly:escape") return;
      const expectedOrigin = preview?.url ? new URL(preview.url).origin : null;
      if (!expectedOrigin || event.origin !== expectedOrigin) return;
      exitPick();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [exitPick, preview?.url]);

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
      if (event.data?.type === "draftly:apply-styles" && event.data.token === preview?.token) {
        applyStyleEdits();
        return;
      }
      if (event.data?.type !== "draftly:selection" || event.data.token !== preview?.token) return;
      const locators = Array.isArray(event.data.locators)
        ? event.data.locators
        : event.data.locator
          ? [event.data.locator]
          : [];
      setSelected(locators);
      const activeIndex = Number.isInteger(event.data.activeIndex) ? event.data.activeIndex : -1;
      setActiveAnnotation(activeIndex >= 0 ? locators[activeIndex] || null : null);
      const focused = (activeIndex >= 0 ? locators[activeIndex] : null) || locators[locators.length - 1];
      if (!focused) return;
      const file = encodeURIComponent(focused.file);
      api(`/api/drafts/${encodeURIComponent(current.meta.id)}/source?file=${file}`, { method: "GET" })
        .then((source) => setCurrent((value) => value ? {
          ...value,
          source: { file: source.file, content: source.source },
        } : value))
        .catch((error) => toast.add({ title: "无法载入所选源码", description: error.message, type: "error" }));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [applyStyleEdits, current?.meta?.id, pickMode, preview?.token, preview?.url, sendPreviewMessage]);

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
          readOnly={readOnly}
          onSignOut={onSignOut}
          onSelectDraft={enterDraft}
          onRename={renameProject}
          onHome={() => onNavigate("/")}
          onNewProject={() => onNavigate("/")}
          onHistory={() => setHistoryOpen(true)}
          onMembers={() => setMembersOpen(true)}
        />
        <main id="workspace-main" className="workspace-layout" style={{ "--chat-width": `${chatWidth}px` }}>
          <PreviewStage
            current={current}
            preview={preview}
            draftDesign={draftDesign}
            styleDesign={EMPTY_DESIGN}
            styleId="__default__"
            stageView={stageView}
            designView={designView}
            previewRef={previewRef}
            sending={sending}
            variantCount={String(drafts.length)}
            pickMode={pickMode}
            selected={selected}
            onPreviewLoad={onPreviewLoad}
            onPreviewNavigate={navigatePreview}
            onStageViewChange={setStageView}
            onDesignViewChange={setDesignView}
            onCopyDesign={copyDesign}
            onCopyValue={copyDesignValue}
            onRetryStyle={() => {}}
            onTogglePick={() => {
              if (pickMode) exitPick();
              else setPickMode(true);
            }}
            onNewDraft={() => onNavigate("/")}
            readOnly={readOnly}
          />
          <div
            className="chat-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="调整对话面板宽度"
            onPointerDown={startChatResize}
            onDoubleClick={() => setChatWidth(332)}
          >
            <span className="chat-resizer-grip" />
          </div>
          <ConversationPanel
            current={current}
            messages={messages}
            conversations={conversationList}
            activeConversationId={isNewKey(activeKey) ? null : activeKey}
            onSelectConversation={selectConversation}
            onNewConversation={newConversation}
            onRenameConversation={renameConversation}
            onDeleteConversation={deleteConversation}
            sending={sending}
            sendingLabel={sendingLabel}
            text={text}
            image={image}
            selected={selected}
            activeAnnotation={activeAnnotation}
            canApplyStyles={selectionHasStyleEdits(selected)}
            styleId="__default__"
            styles={[]}
            variants="1"
            fileRef={fileRef}
            chatEndRef={chatEndRef}
            onTextChange={setText}
            onStyleChange={() => {}}
            onVariantsChange={() => {}}
            onRemoveImage={() => setImage(null)}
            onRemoveSelected={deselectOne}
            onClearSelected={cancelPick}
            onCommentChange={updateSelectedComment}
            onFocusAnnotation={focusAnnotation}
            onApplyStyles={applyStyleEdits}
            onSend={send}
            onSelectVariant={enterDraft}
            onDismissMessage={dismissMessage}
            piModels={piModels}
            piDefaults={piDefaults}
            piModel={piModel}
            piThinking={piThinking}
            onPiModelChange={setPiModel}
            onPiThinkingChange={setPiThinking}
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
          rollbackVersion={rollbackVersion}
          onHistoryChange={setHistoryOpen}
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
