import {
  ArrowLeftIcon,
  ArrowRightIcon,
  Code2Icon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileTextIcon,
  LockIcon,
  Maximize2Icon,
  Minimize2Icon,
  MousePointer2Icon,
  MonitorIcon,
  PaletteIcon,
  PlusIcon,
  RefreshCwIcon,
  SparklesIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { DesignCode, DesignSpecimen } from "@/components/design-preview";
import { DesignSystemView } from "@/components/design-system-view";
import { stripFrontMatter } from "@/lib/design-system";
import { SourceWorkspace } from "@/components/source-workspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function GenerationPlaceholder({ variantCount }) {
  return (
    <div className="generation-placeholder" aria-live="polite" aria-busy="true">
      <div className="generation-placeholder-head">
        <div className="generation-placeholder-copy">
          <div className="generation-kicker"><Spinner /> 正在构建可运行的 React 页面</div>
          <h2>从需求到源码，工作区正在成形</h2>
          <p>组件、样式和交互会逐步完成。构建通过后，画布将自动切换为实时预览。</p>
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

function PreviewAction({ label, children, nativeButton, ...props }) {
  return (
    <Tooltip>
      <TooltipTrigger
        nativeButton={nativeButton}
        render={<Button variant="ghost" size="icon" aria-label={label} nativeButton={nativeButton} {...props} />}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function PreviewStage({
  current,
  preview,
  draftDesign,
  styleDesign,
  styleId,
  stageView,
  designView = "system",
  previewRef,
  sending,
  variantCount,
  pickMode,
  selected = [],
  onPreviewLoad,
  onPreviewNavigate,
  onStageViewChange,
  onDesignViewChange,
  onCopyDesign,
  onCopyValue,
  onRetryStyle,
  onTogglePick,
  onNewDraft,
  readOnly = false,
}) {
  const previewUrl = preview?.url;
  const [frameLoading, setFrameLoading] = useState(Boolean(previewUrl));
  const frameShellRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    setFrameLoading(Boolean(previewUrl));
  }, [previewUrl]);

  useEffect(() => {
    const handleChange = () => {
      setIsFullscreen(document.fullscreenElement === frameShellRef.current);
    };
    document.addEventListener("fullscreenchange", handleChange);
    return () => document.removeEventListener("fullscreenchange", handleChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      frameShellRef.current?.requestFullscreen?.();
    }
  }, []);

  const handleFrameLoad = useCallback((event) => {
    setFrameLoading(false);
    onPreviewLoad?.(event);
  }, [onPreviewLoad]);

  const handleNavigate = useCallback((action) => {
    if (action === "reload") setFrameLoading(true);
    onPreviewNavigate(action);
  }, [onPreviewNavigate]);

  if (!current) {
    if (sending) return <GenerationPlaceholder variantCount={variantCount} />;
    if (styleId !== "__default__") {
      return (
        <StylePreviewStage
          state={styleDesign}
          value={stageView}
          designView={designView}
          onValueChange={onStageViewChange}
          onDesignViewChange={onDesignViewChange}
          onCopy={onCopyDesign}
          onCopyValue={onCopyValue}
          onRetry={onRetryStyle}
        />
      );
    }
    return (
      <div className="workspace-empty">
        <Empty className="max-w-xl border-0">
          <EmptyHeader>
            <EmptyMedia variant="icon"><SparklesIcon /></EmptyMedia>
            <EmptyTitle className="text-xl">把想法变成可运行的界面</EmptyTitle>
            <EmptyDescription>
              在右侧描述页面目标、内容与风格。Draftly 会生成独立 React 项目，并在这里展示实时预览。
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <div className="prompt-examples" aria-label="示例需求">
              <span>产品发布页</span>
              <span>数据工作台</span>
              <span>移动端应用</span>
            </div>
            <Button onClick={onNewDraft}>
              <PlusIcon data-icon="inline-start" />
              开始新草稿
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  const designContent = draftDesign.data?.content;
  return (
    <Tabs
      className="preview-stage gap-0"
      value={stageView}
      onValueChange={onStageViewChange}
      aria-label="草稿预览"
    >
      <div className="stage-toolbar">
        <div className="stage-actions">
          <Badge variant="secondary" className="stage-version">v{current.version}</Badge>
          <PreviewTabs showSource />
          {stageView === "preview" ? (
            <>
              <Button disabled={readOnly} variant={pickMode ? "default" : "outline"} onClick={onTogglePick}>
                <MousePointer2Icon data-icon="inline-start" />
                {pickMode ? "退出标注" : "标注"}
              </Button>
            </>
          ) : null}
          {stageView === "design" ? (
            <>
              <DesignViewSwitch value={designView} onChange={onDesignViewChange} />
              <Button variant="outline" disabled={!designContent} onClick={onCopyDesign}>
                <CopyIcon data-icon="inline-start" />
                复制
              </Button>
            </>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              nativeButton={false}
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="导出源码 ZIP"
                  nativeButton={false}
                  render={<a href={`/api/drafts/${encodeURIComponent(current.meta.id)}/export`} target="_blank" rel="noreferrer" />}
                />
              }
            >
              <DownloadIcon />
            </TooltipTrigger>
            <TooltipContent>导出源码 ZIP</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <TabsContent value="preview" className="stage-panel">
        <div className="preview-frame-shell" ref={frameShellRef}>
          <div className="preview-browser-bar">
            <div className="preview-navigation" aria-label="预览导航">
              <PreviewAction label="后退" onClick={() => handleNavigate("back")}>
                <ArrowLeftIcon />
              </PreviewAction>
              <PreviewAction label="前进" onClick={() => handleNavigate("forward")}>
                <ArrowRightIcon />
              </PreviewAction>
              <PreviewAction label="刷新预览" onClick={() => handleNavigate("reload")}>
                <RefreshCwIcon />
              </PreviewAction>
            </div>
            <a
              className="preview-address"
              href={preview?.url}
              target="_blank"
              rel="noreferrer"
              title={preview?.url}
            >
              <LockIcon className="preview-address-status" aria-hidden="true" />
              <span>{preview?.url || "正在启动预览"}</span>
            </a>
            <div className="preview-window-actions">
              <span className="preview-status">实时</span>
              <PreviewAction
                label={isFullscreen ? "退出全屏" : "全屏预览"}
                onClick={toggleFullscreen}
              >
                {isFullscreen ? <Minimize2Icon /> : <Maximize2Icon />}
              </PreviewAction>
              <PreviewAction
                label="在新窗口打开"
                nativeButton={false}
                render={<a href={preview?.url} target="_blank" rel="noreferrer" />}
              >
                <ExternalLinkIcon />
              </PreviewAction>
            </div>
          </div>
          <div className="preview-frame-body">
            <iframe
              ref={previewRef}
              id="preview"
              title={`${current.meta.title} 预览`}
              src={preview?.url}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              onLoad={handleFrameLoad}
            />
            {frameLoading ? <PreviewSkeleton /> : null}
          </div>
        </div>
      </TabsContent>
      <TabsContent value="design" className="stage-panel">
        <DesignState
          state={draftDesign}
          content={designContent}
          meta={draftDesign.data?.meta}
          name={current.meta.title}
          view={designView}
          onCopyValue={onCopyValue}
        />
      </TabsContent>
      <TabsContent value="source" className="stage-panel stage-panel-source">
        <SourceWorkspace current={current} onClose={() => onStageViewChange("preview")} />
      </TabsContent>
    </Tabs>
  );
}

/** 预览 iframe 首次载入 / 刷新期间的骨架屏，形状对齐生成页面的常见结构 */
function PreviewSkeleton() {
  return (
    <div className="preview-skeleton" aria-live="polite" aria-busy="true">
      <span className="sr-only">正在载入预览</span>
      <div className="preview-skeleton-bar">
        <Skeleton className="h-5 w-28" />
        <div className="preview-skeleton-nav">
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-4 w-14" />
        </div>
        <Skeleton className="h-7 w-20" />
      </div>
      <div className="preview-skeleton-hero">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-9 w-4/5" />
        <Skeleton className="h-9 w-3/5" />
        <Skeleton className="h-4 w-2/3" />
        <div className="preview-skeleton-actions">
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-24" />
        </div>
      </div>
      <div className="preview-skeleton-grid">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    </div>
  );
}

/** DESIGN.md tab 里在「可视化设计系统」与「原始 Markdown」之间切换 */
function DesignViewSwitch({ value = "system", onChange }) {
  if (!onChange) return null;
  return (
    <div className="design-view-switch" role="group" aria-label="设计系统展示方式">
      <button
        type="button"
        data-active={value === "system" ? "" : undefined}
        aria-pressed={value === "system"}
        onClick={() => onChange("system")}
      >
        <PaletteIcon data-icon="inline-start" />
        预览
      </button>
      <button
        type="button"
        data-active={value === "source" ? "" : undefined}
        aria-pressed={value === "source"}
        onClick={() => onChange("source")}
      >
        <FileTextIcon data-icon="inline-start" />
        design.md
      </button>
    </div>
  );
}

function PreviewTabs({ showSource = false }) {
  return (
    <TabsList>
      <TabsTrigger value="preview">
        <MonitorIcon data-icon="inline-start" />
        实时预览
      </TabsTrigger>
      <TabsTrigger value="design">
        <FileTextIcon data-icon="inline-start" />
        设计系统
      </TabsTrigger>
      {showSource ? (
        <TabsTrigger value="source">
          <Code2Icon data-icon="inline-start" />
          源码
        </TabsTrigger>
      ) : null}
    </TabsList>
  );
}

function StylePreviewStage({ state, value, designView = "system", onValueChange, onDesignViewChange, onCopy, onCopyValue, onRetry }) {
  const template = state.data;
  return (
    <Tabs
      className="preview-stage gap-0"
      value={value}
      onValueChange={onValueChange}
      aria-label="内置风格预览"
    >
      <div className="stage-toolbar">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="stage-title">{template?.name || "载入风格预览"}</h1>
            {template ? <Badge variant="secondary">内置风格</Badge> : null}
          </div>
          <p className="stage-prompt">
            {template ? [...template.tags.style, ...template.tags.industry].join(" · ") : "正在读取 DESIGN.md"}
          </p>
        </div>
        <div className="stage-actions">
          <PreviewTabs />
          {value === "design" ? (
            <>
              <DesignViewSwitch value={designView} onChange={onDesignViewChange} />
              <Button variant="outline" disabled={!template?.designMd} onClick={onCopy}>
                <CopyIcon data-icon="inline-start" />
                复制
              </Button>
            </>
          ) : null}
        </div>
      </div>
      <TabsContent value="preview" className="stage-panel">
        {state.status === "ready" ? (
          <div className="design-preview-shell">
            <DesignSpecimen meta={template.meta} label={template.name} />
          </div>
        ) : <DesignState state={state} onRetry={onRetry} />}
      </TabsContent>
      <TabsContent value="design" className="stage-panel">
        <DesignState
          state={state}
          content={template?.designMd}
          meta={template?.meta}
          name={template?.name}
          view={designView}
          onRetry={onRetry}
          onCopyValue={onCopyValue}
        />
      </TabsContent>
    </Tabs>
  );
}

function DesignState({ state, content, meta, name, view = "system", onRetry, onCopyValue }) {
  if (state.status === "loading" || state.status === "idle") {
    return (
      <div className="design-state design-loading" aria-live="polite" aria-busy="true">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="design-state">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><FileTextIcon /></EmptyMedia>
            <EmptyTitle>无法载入 DESIGN.md</EmptyTitle>
            <EmptyDescription>{state.error}</EmptyDescription>
          </EmptyHeader>
          {onRetry ? (
            <EmptyContent>
              <Button variant="outline" onClick={onRetry}>
                <RefreshCwIcon data-icon="inline-start" />
                重试
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      </div>
    );
  }
  if (!content) {
    return (
      <div className="design-state">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><FileTextIcon /></EmptyMedia>
            <EmptyTitle>此草稿没有 DESIGN.md</EmptyTitle>
            <EmptyDescription>使用具体内置风格生成的新草稿会在这里显示设计规范。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }
  if (view === "system") {
    return (
      <DesignSystemView
        meta={meta}
        name={name}
        body={stripFrontMatter(content)}
        onCopyValue={onCopyValue}
      />
    );
  }
  return <DesignCode content={content} />;
}
