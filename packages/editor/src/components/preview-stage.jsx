import {
  Code2Icon,
  DownloadIcon,
  MousePointer2Icon,
  PlusIcon,
  SparklesIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
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
  previewRef,
  sending,
  variantCount,
  pickMode,
  selected,
  onPreviewLoad,
  onTogglePick,
  onOpenSource,
  onNewDraft,
}) {
  if (!current) {
    return sending ? <GenerationPlaceholder variantCount={variantCount} /> : (
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

  return (
    <section className="preview-stage" aria-label="草稿预览">
      <div className="stage-toolbar">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="stage-title">{current.meta.title}</h1>
            <Badge variant="secondary">v{current.version}</Badge>
          </div>
          <p className="stage-prompt">{current.meta.prompt}</p>
        </div>
        <div className="stage-actions">
          {selected ? (
            <Badge variant="outline" className="selected-badge">
              <MousePointer2Icon data-icon="inline-start" />
              {selected.component || selected.tagName}
            </Badge>
          ) : null}
          <Button variant={pickMode ? "default" : "outline"} onClick={onTogglePick}>
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
        </div>
      </div>
      <div className="preview-frame-shell">
        <div className="preview-browser-bar" aria-hidden="true">
          <div className="browser-dots"><span /><span /><span /></div>
          <div className="preview-address">localhost · {current.meta.title}</div>
          <span className="preview-status">实时</span>
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
    </section>
  );
}
