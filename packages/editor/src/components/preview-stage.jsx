import {
  ArrowLeftIcon,
  ArrowRightIcon,
  Code2Icon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileTextIcon,
  Maximize2Icon,
  MousePointer2Icon,
  MonitorIcon,
  PlusIcon,
  RefreshCwIcon,
  SparklesIcon,
} from "lucide-react";
import { DesignCode, DesignSpecimen } from "@/components/design-preview";
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

function PreviewAction({ label, children, ...props }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon" aria-label={label} {...props} />}>
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
  previewRef,
  sending,
  variantCount,
  pickMode,
  selected,
  onPreviewLoad,
  onPreviewNavigate,
  onStageViewChange,
  onCopyDesign,
  onRetryStyle,
  onTogglePick,
  onOpenSource,
  onNewDraft,
  readOnly = false,
}) {
  if (!current) {
    if (sending) return <GenerationPlaceholder variantCount={variantCount} />;
    if (styleId !== "__default__") {
      return (
        <StylePreviewStage
          state={styleDesign}
          value={stageView}
          onValueChange={onStageViewChange}
          onCopy={onCopyDesign}
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
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="stage-title">{current.meta.title}</h1>
            <Badge variant="secondary">v{current.version}</Badge>
          </div>
          <p className="stage-prompt">{current.meta.prompt}</p>
        </div>
        <div className="stage-actions">
          <PreviewTabs />
          {stageView === "preview" ? (
            <>
              {selected ? (
                <Badge variant="outline" className="selected-badge">
                  <MousePointer2Icon data-icon="inline-start" />
                  {selected.component || selected.tagName}
                </Badge>
              ) : null}
              <Button disabled={readOnly} variant={pickMode ? "default" : "outline"} onClick={onTogglePick}>
                <MousePointer2Icon data-icon="inline-start" />
                {pickMode ? "退出点选" : "点选修改"}
              </Button>
              <PreviewAction label="查看源码" onClick={onOpenSource}>
                <Code2Icon />
              </PreviewAction>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="导出源码 ZIP"
                      render={<a href={`/api/drafts/${encodeURIComponent(current.meta.id)}/export`} target="_blank" rel="noreferrer" />}
                    />
                  }
                >
                  <DownloadIcon />
                </TooltipTrigger>
                <TooltipContent>导出源码 ZIP</TooltipContent>
              </Tooltip>
            </>
          ) : (
            <Button variant="outline" disabled={!designContent} onClick={onCopyDesign}>
              <CopyIcon data-icon="inline-start" />
              复制
            </Button>
          )}
        </div>
      </div>
      <TabsContent value="preview" className="stage-panel">
        <div className="preview-frame-shell">
          <div className="preview-browser-bar">
            <div className="preview-navigation" aria-label="预览导航">
              <PreviewAction label="后退" onClick={() => onPreviewNavigate("back")}>
                <ArrowLeftIcon />
              </PreviewAction>
              <PreviewAction label="前进" onClick={() => onPreviewNavigate("forward")}>
                <ArrowRightIcon />
              </PreviewAction>
              <PreviewAction label="刷新预览" onClick={() => onPreviewNavigate("reload")}>
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
              <span className="preview-address-status" aria-hidden="true" />
              <span>{preview?.url || "正在启动预览"}</span>
            </a>
            <div className="preview-window-actions">
              <span className="preview-status">实时</span>
              <PreviewAction
                label="全屏预览"
                onClick={(event) => event.currentTarget.closest(".preview-frame-shell")?.requestFullscreen()}
              >
                <Maximize2Icon />
              </PreviewAction>
              <PreviewAction
                label="在新窗口打开"
                render={<a href={preview?.url} target="_blank" rel="noreferrer" />}
              >
                <ExternalLinkIcon />
              </PreviewAction>
            </div>
          </div>
          <iframe
            ref={previewRef}
            id="preview"
            title={`${current.meta.title} 预览`}
            src={preview?.url}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            onLoad={onPreviewLoad}
          />
        </div>
      </TabsContent>
      <TabsContent value="design" className="stage-panel">
        <DesignState state={draftDesign} content={designContent} />
      </TabsContent>
    </Tabs>
  );
}

function PreviewTabs() {
  return (
    <TabsList>
      <TabsTrigger value="preview">
        <MonitorIcon data-icon="inline-start" />
        实时预览
      </TabsTrigger>
      <TabsTrigger value="design">
        <FileTextIcon data-icon="inline-start" />
        DESIGN.md
      </TabsTrigger>
    </TabsList>
  );
}

function StylePreviewStage({ state, value, onValueChange, onCopy, onRetry }) {
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
            <Button variant="outline" disabled={!template?.designMd} onClick={onCopy}>
              <CopyIcon data-icon="inline-start" />
              复制
            </Button>
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
        <DesignState state={state} content={template?.designMd} onRetry={onRetry} />
      </TabsContent>
    </Tabs>
  );
}

function DesignState({ state, content, onRetry }) {
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
  return <DesignCode content={content} />;
}
