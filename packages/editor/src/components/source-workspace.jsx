import {
  AlertCircleIcon,
  ChevronRightIcon,
  Code2Icon,
  FileCode2Icon,
  FileJson2Icon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  RefreshCwIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import {
  buildSourceTree,
  defaultSourceFile,
  filterSourceTree,
  formatSourceSize,
  sourceLanguage,
  sourceParentPaths,
} from "@/lib/source-workspace";
import { cn } from "@/lib/utils";

const SourceCodeEditor = lazy(() => import("@/components/source-code-editor"));

function fileIcon(filePath) {
  if (filePath.endsWith(".json")) return <FileJson2Icon />;
  if (filePath.endsWith(".md") || filePath.endsWith(".txt")) return <FileTextIcon />;
  return <FileCode2Icon />;
}

function SourceTree({
  nodes,
  activePath,
  expanded,
  filtered,
  onSelect,
  onToggle,
  depth = 0,
}) {
  return nodes.map((node) => {
    if (node.type === "directory") {
      const isExpanded = filtered || expanded.has(node.path);
      return (
        <div key={node.path}>
          <button
            type="button"
            role="treeitem"
            className="source-tree-row"
            style={{ paddingLeft: `${8 + depth * 14}px` }}
            aria-expanded={isExpanded}
            onClick={() => onToggle(node.path)}
          >
            <ChevronRightIcon className={cn("source-tree-chevron", isExpanded && "is-expanded")} />
            {isExpanded ? <FolderOpenIcon className="source-tree-folder" /> : <FolderIcon className="source-tree-folder" />}
            <span>{node.name}</span>
          </button>
          {isExpanded ? (
            <SourceTree
              nodes={node.children}
              activePath={activePath}
              expanded={expanded}
              filtered={filtered}
              onSelect={onSelect}
              onToggle={onToggle}
              depth={depth + 1}
            />
          ) : null}
        </div>
      );
    }

    return (
      <button
        key={node.path}
        type="button"
        role="treeitem"
        className={cn("source-tree-row source-tree-file", activePath === node.path && "is-active")}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        title={`${node.path} (${formatSourceSize(node.size)})`}
        onClick={() => onSelect(node.path)}
      >
        <span className="source-tree-spacer" />
        {fileIcon(node.path)}
        <span>{node.name}</span>
      </button>
    );
  });
}

function WorkspaceState({ icon: Icon = Code2Icon, title, description, action }) {
  return (
    <div className="source-workspace-state">
      <Icon />
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  );
}

export function SourceWorkspace({ current, onClose }) {
  const draftId = current?.meta?.id;
  const preferredPath = current?.source?.file;
  const [listState, setListState] = useState({ status: "idle", files: [], error: "" });
  const [activePath, setActivePath] = useState(null);
  const [documents, setDocuments] = useState({});
  const [expanded, setExpanded] = useState(new Set());
  const [query, setQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const filterRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadFiles = useCallback(async () => {
    if (!draftId) return;
    setListState({ status: "loading", files: [], error: "" });
    setDocuments(current?.source?.content && preferredPath ? {
      [preferredPath]: { status: "ready", source: current.source.content, error: "" },
    } : {});
    try {
      const result = await api(`/api/drafts/${encodeURIComponent(draftId)}/files`, { method: "GET" });
      if (!mountedRef.current) return;
      const remembered = sessionStorage.getItem(`draftly:source-file:${draftId}`);
      const nextPath = defaultSourceFile(result.files, remembered || preferredPath);
      setListState({ status: "ready", files: result.files, error: "" });
      setActivePath(nextPath);
      setExpanded(new Set(sourceParentPaths(nextPath)));
    } catch (error) {
      if (!mountedRef.current) return;
      setListState({ status: "error", files: [], error: error.message });
      setActivePath(null);
    }
  }, [current?.source?.content, draftId, preferredPath]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    if (!activePath || !draftId || documents[activePath]) return;
    setDocuments((previous) => ({
      ...previous,
      [activePath]: { status: "loading", source: "", error: "" },
    }));
    api(
      `/api/drafts/${encodeURIComponent(draftId)}/source?file=${encodeURIComponent(activePath)}`,
      { method: "GET" },
    ).then((result) => {
      if (!mountedRef.current) return;
      setDocuments((previous) => ({
        ...previous,
        [activePath]: { status: "ready", source: result.source, error: "" },
      }));
    }).catch((error) => {
      if (!mountedRef.current) return;
      setDocuments((previous) => ({
        ...previous,
        [activePath]: { status: "error", source: "", error: error.message },
      }));
    });
  }, [activePath, documents, draftId]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "p") {
        event.preventDefault();
        setSidebarOpen(true);
        requestAnimationFrame(() => filterRef.current?.focus());
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const tree = useMemo(() => buildSourceTree(listState.files), [listState.files]);
  const filteredTree = useMemo(() => filterSourceTree(tree, query), [query, tree]);
  const activeDocument = activePath ? documents[activePath] : null;
  const activeFile = listState.files.find((file) => file.path === activePath);

  const selectFile = (filePath) => {
    setActivePath(filePath);
    sessionStorage.setItem(`draftly:source-file:${draftId}`, filePath);
    if (window.matchMedia("(max-width: 48rem)").matches) setSidebarOpen(false);
  };

  const retrySource = () => {
    if (!activePath) return;
    setDocuments((previous) => {
      const next = { ...previous };
      delete next[activePath];
      return next;
    });
  };

  const dark = document.documentElement.classList.contains("dark");

  return (
    <div className="source-workspace">
      <header className="source-workspace-header">
        <div className="source-workspace-heading">
          <span className="source-workspace-mark"><Code2Icon /></span>
          <div className="min-w-0">
            <DialogTitle>项目源码</DialogTitle>
            <p>{current?.meta?.title || "React 项目"}</p>
          </div>
          {current?.version ? <Badge variant="secondary">v{current.version}</Badge> : null}
        </div>
        <Button variant="ghost" size="icon" aria-label="关闭源码工作台" onClick={onClose}>
          <XIcon />
        </Button>
      </header>

      <div className={cn("source-workspace-body", !sidebarOpen && "sidebar-collapsed")}>
        {sidebarOpen ? (
          <aside className="source-workspace-sidebar" aria-label="项目文件">
            <div className="source-explorer-header">
              <span>资源管理器</span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="收起资源管理器"
                onClick={() => setSidebarOpen(false)}
              >
                <PanelLeftCloseIcon />
              </Button>
            </div>
            <div className="source-filter">
              <SearchIcon />
              <Input
                ref={filterRef}
                value={query}
                aria-label="筛选源码文件"
                placeholder="筛选文件..."
                onChange={(event) => setQuery(event.target.value)}
              />
              <kbd>{navigator.platform.includes("Mac") ? "⌘" : "Ctrl"} P</kbd>
            </div>
            <div className="source-tree" role="tree" aria-label="源码文件树">
              {listState.status === "loading" ? (
                <div className="source-tree-loading" aria-label="正在载入项目文件">
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="ml-4 h-5 w-3/4" />
                  <Skeleton className="ml-4 h-5 w-1/2" />
                  <Skeleton className="h-5 w-1/2" />
                </div>
              ) : null}
              {listState.status === "error" ? (
                <WorkspaceState
                  icon={AlertCircleIcon}
                  title="无法载入文件"
                  description={listState.error}
                  action={<Button size="sm" variant="outline" onClick={loadFiles}><RefreshCwIcon />重试</Button>}
                />
              ) : null}
              {listState.status === "ready" && listState.files.length === 0 ? (
                <WorkspaceState title="没有可浏览的源码" description="项目中未找到支持的文本源码文件。" />
              ) : null}
              {listState.status === "ready" && listState.files.length > 0 && filteredTree.length === 0 ? (
                <WorkspaceState icon={SearchIcon} title="没有匹配文件" description="尝试缩短文件名或路径关键词。" />
              ) : null}
              {listState.status === "ready" && filteredTree.length > 0 ? (
                <SourceTree
                  nodes={filteredTree}
                  activePath={activePath}
                  expanded={expanded}
                  filtered={Boolean(query.trim())}
                  onSelect={selectFile}
                  onToggle={(path) => setExpanded((previous) => {
                    const next = new Set(previous);
                    if (next.has(path)) next.delete(path);
                    else next.add(path);
                    return next;
                  })}
                />
              ) : null}
            </div>
            {listState.status === "ready" ? (
              <div className="source-explorer-footer">{listState.files.length} 个文件</div>
            ) : null}
          </aside>
        ) : null}

        <section className="source-editor-panel" aria-label="源码内容">
          <div className="source-editor-tabs">
            {!sidebarOpen ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="展开资源管理器"
                onClick={() => setSidebarOpen(true)}
              >
                <PanelLeftOpenIcon />
              </Button>
            ) : null}
            {activePath ? (
              <div className="source-editor-tab" title={activePath}>
                {fileIcon(activePath)}
                <span>{activePath.split("/").at(-1)}</span>
              </div>
            ) : (
              <span className="source-editor-tab-placeholder">选择文件</span>
            )}
          </div>
          {activePath ? (
            <div className="source-editor-breadcrumb">
              <span>{activePath.split("/").join(" / ")}</span>
              {activeFile ? <span>{formatSourceSize(activeFile.size)}</span> : null}
            </div>
          ) : null}
          <div className="source-editor-content">
            {!activePath ? (
              <WorkspaceState title="打开一个文件" description="从资源管理器中选择源码文件开始阅读。" />
            ) : null}
            {activeDocument?.status === "loading" ? (
              <div className="source-editor-loading" aria-label="正在载入源码">
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ) : null}
            {activeDocument?.status === "error" ? (
              <WorkspaceState
                icon={AlertCircleIcon}
                title="无法载入源码"
                description={activeDocument.error}
                action={<Button size="sm" variant="outline" onClick={retrySource}><RefreshCwIcon />重试</Button>}
              />
            ) : null}
            {activeDocument?.status === "ready" ? (
              <Suspense fallback={<div className="source-editor-loading"><Skeleton className="h-4 w-3/4" /></div>}>
                <SourceCodeEditor
                  filePath={activePath}
                  language={sourceLanguage(activePath)}
                  source={activeDocument.source}
                  dark={dark}
                />
              </Suspense>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
