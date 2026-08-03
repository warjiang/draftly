import {
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  ImageIcon,
  MessageSquarePlusIcon,
  MousePointer2Icon,
  PaletteIcon,
  PaperclipIcon,
  PencilIcon,
  SparklesIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { groupProgressSteps } from "@/lib/progress";
import { countStyleEdits, sameAnnotation } from "@/lib/annotations";

const PI_THINKING_OPTIONS = [
  ["off", "关闭思考"],
  ["minimal", "极简"],
  ["low", "低"],
  ["medium", "中"],
  ["high", "高"],
  ["xhigh", "超高"],
  ["max", "最大"],
];

function PiOptions({ models, defaults, model, thinking, disabled, onModelChange, onThinkingChange }) {
  const providers = [];
  for (const item of models) {
    let group = providers.find(([name]) => name === item.provider);
    if (!group) {
      group = [item.provider, []];
      providers.push(group);
    }
    group[1].push(item);
  }
  const defaultModelLabel = defaults?.model
    ? `默认 · ${defaults.model}`
    : "默认模型";
  const defaultThinkingLabel = defaults?.thinking
    ? `思考 · ${defaults.thinking}`
    : "默认思考";
  const modelLabel = model === "__default__" ? defaultModelLabel : model.split("::")[1] || model;
  const thinkingLabel = thinking === "__default__"
    ? defaultThinkingLabel
    : `思考 · ${PI_THINKING_OPTIONS.find(([value]) => value === thinking)?.[1] || thinking}`;
  return (
    <div className="pi-options">
      <Select value={model} disabled={disabled} onValueChange={onModelChange}>
        <SelectTrigger aria-label="选择模型"><SelectValue>{modelLabel}</SelectValue></SelectTrigger>
        <SelectContent className="min-w-56">
          <SelectGroup>
            <SelectItem value="__default__">{defaultModelLabel}</SelectItem>
          </SelectGroup>
          {providers.map(([provider, items]) => (
            <SelectGroup key={provider}>
              <SelectLabel>{provider}</SelectLabel>
              {items.map((item) => (
                <SelectItem key={`${item.provider}::${item.id}`} value={`${item.provider}::${item.id}`}>
                  {item.id}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      <Select value={thinking} disabled={disabled} onValueChange={onThinkingChange}>
        <SelectTrigger aria-label="选择思考强度"><SelectValue>{thinkingLabel}</SelectValue></SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="__default__">{defaultThinkingLabel}</SelectItem>
            {PI_THINKING_OPTIONS.map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}

function ProgressTree({ steps }) {
  return (
    <div className="progress-list">
      {groupProgressSteps(steps).map(([variant, variantSteps]) => (
        <div className="progress-group" key={variant}>
          {variant ? <div className="progress-group-title">方案 {variant}</div> : null}
          {variantSteps.filter((step) => !step.parent).map((step) => {
            const children = variantSteps.filter((child) => child.parent === step.key);
            return (
              <div className="progress-phase-block" key={step.key}>
                <div className={cn("progress-step progress-phase", step.status)}>
                  <span className="progress-icon">
                    {step.status === "done" ? <CheckIcon /> : <span className="progress-dot" />}
                  </span>
                  <span className="progress-label">{step.label}</span>
                  {step.detail ? <span className="progress-detail">{step.detail}</span> : null}
                </div>
                {children.length ? (
                  <div className="progress-children">
                    {children.map((child) => (
                      <div key={child.key} className={cn("progress-step progress-child", child.tool && "progress-call", child.status)}>
                        <span className="progress-icon">
                          {child.status === "done" ? <CheckIcon /> : <span className="progress-dot" />}
                        </span>
                        <span className="progress-label">{child.label}</span>
                        {child.detail ? (
                          child.tool
                            ? <code className="progress-target" title={child.detail}>{child.detail}</code>
                            : <span className="progress-detail">{child.detail}</span>
                        ) : null}
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
  );
}

function SystemMessage({ message, onDismiss }) {
  return (
    <div className={cn("system-message", message.dismissible && "system-message-dismissible")}>
      <SparklesIcon />
      <span>{message.text}</span>
      {message.dismissible && onDismiss ? (
        <button
          type="button"
          className="system-message-close"
          aria-label="关闭提示"
          title="关闭提示"
          onClick={() => onDismiss(message)}
        >
          <XIcon />
        </button>
      ) : null}
    </div>
  );
}

function UserMessage({ message }) {
  const locators = message.locators || (message.locator ? [message.locator] : []);
  return (
    <div className="message-row message-user">
      <div className="message-bubble user-bubble">
        {message.image ? <img className="message-image" src={message.image} alt="参考截图" /> : null}
        {locators.length ? (
          <div className="message-annotations">
            {locators.map((loc, index) => (
              <div className="message-annotation" key={`${loc.file}:${loc.line}:${loc.column}:${index}`}>
                <span className="message-annotation-target">
                  {loc.component || loc.tagName} · {loc.file}:{loc.line}
                </span>
                {loc.comment?.trim() ? (
                  <span className="message-annotation-comment">{loc.comment.trim()}</span>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        {message.text ? <p>{message.text}</p> : null}
      </div>
    </div>
  );
}

function AssistantMessage({ message, onSelectVariant }) {
  if (message.kind === "error") {
    return (
      <div className="message-row message-assistant">
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>任务未完成</AlertTitle>
          <AlertDescription>{message.text.replace(/^✗\s*/, "")}</AlertDescription>
          {message.steps?.length ? <ProgressTree steps={message.steps} /> : null}
        </Alert>
      </div>
    );
  }

  const pending = message.kind === "pending";
  const hasSteps = Boolean(message.steps?.length);

  return (
    <div className="message-row message-assistant">
      <div className="assistant-trace">
        {pending ? (
          <div className="assistant-trace-head">
            <Spinner />
            <span>{message.text.replace(/^✓\s*/, "")}</span>
            <Badge variant="secondary">运行中</Badge>
          </div>
        ) : null}
        {hasSteps ? <ProgressTree steps={message.steps} /> : null}
        {!pending && !hasSteps ? (
          <div className="assistant-trace-note">{message.text.replace(/^✓\s*/, "")}</div>
        ) : null}
        {message.variants?.length ? (
          <div className="variant-list">
            {message.variants.map((variant) => (
              <Button
                key={variant.id}
                variant={variant.chosen ? "default" : "outline"}
                className="justify-start"
                onClick={() => onSelectVariant(variant.id)}
              >
                {message.variants.length > 1 ? `方案 ${variant.index}` : null}
                <span className="truncate text-left">{variant.title}</span>
              </Button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ConversationMessage({ message, onSelectVariant, onDismiss }) {
  if (message.role === "system") return <SystemMessage message={message} onDismiss={onDismiss} />;
  if (message.role === "user") return <UserMessage message={message} />;
  return <AssistantMessage message={message} onSelectVariant={onSelectVariant} />;
}

function ContextChip({ icon: Icon, children, onRemove }) {
  return (
    <Badge variant="outline" className="context-chip">
      <Icon data-icon="inline-start" />
      <span className="truncate">{children}</span>
      <button type="button" aria-label="移除上下文" onClick={onRemove}><XIcon /></button>
    </Badge>
  );
}

function formatConversationTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function SessionSwitcher({
  conversations,
  activeConversationId,
  onSelect,
  onNew,
  onRename,
  onDelete,
  disabled = false,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);

  const active = conversations.find((item) => item.id === activeConversationId) || null;
  const label = active?.title || "新会话";

  const submitRename = () => {
    const value = renameValue.trim();
    if (renameTarget && value) onRename(renameTarget.id, value);
    setRenameTarget(null);
  };

  return (
    <div className="session-switcher">
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger
          disabled={disabled}
          className="session-trigger"
          data-disabled={disabled || undefined}
        >
          <span className="session-trigger-label">{label}</span>
          <ChevronDownIcon className="session-trigger-chevron" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="session-menu">
          <div className="session-menu-label">会话记录</div>
          {conversations.length ? (
            conversations.map((item) => (
              <DropdownMenuItem
                key={item.id}
                className="session-item"
                onSelect={() => onSelect(item.id)}
              >
                <span className="session-item-check">
                  {item.id === activeConversationId ? <CheckIcon /> : null}
                </span>
                <span className="session-item-main">
                  <span className="session-item-title">{item.title || "未命名会话"}</span>
                  <span className="session-item-meta">
                    {formatConversationTime(item.updatedAt)} · {item.messageCount || 0} 条
                  </span>
                </span>
                <span className="session-item-actions">
                  <span
                    role="button"
                    tabIndex={0}
                    className="session-item-action"
                    title="重命名"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setMenuOpen(false);
                      setRenameTarget(item);
                      setRenameValue(item.title || "");
                    }}
                  >
                    <PencilIcon />
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    className="session-item-action session-item-action-danger"
                    title="删除"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setMenuOpen(false);
                      setDeleteTarget(item);
                    }}
                  >
                    <Trash2Icon />
                  </span>
                </span>
              </DropdownMenuItem>
            ))
          ) : (
            <div className="session-empty">还没有历史会话</div>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="session-new" onSelect={() => onNew()}>
            <MessageSquarePlusIcon />
            <span>新建会话</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="session-new-button"
              aria-label="新建会话"
              disabled={disabled}
              onClick={() => onNew()}
            />
          }
        >
          <MessageSquarePlusIcon />
        </TooltipTrigger>
        <TooltipContent>新建会话</TooltipContent>
      </Tooltip>

      <Dialog open={Boolean(renameTarget)} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent className="session-rename-dialog">
          <DialogHeader>
            <DialogTitle>重命名会话</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={renameValue}
            maxLength={120}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitRename();
              }
            }}
            placeholder="会话名称"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>取消</Button>
            <Button onClick={submitRename} disabled={!renameValue.trim()}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这个会话？</AlertDialogTitle>
            <AlertDialogDescription>
              「{deleteTarget?.title || "未命名会话"}」的所有消息记录会被永久删除，且无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) onDelete(deleteTarget.id);
                setDeleteTarget(null);
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function ConversationPanel({
  current,
  messages,
  conversations = [],
  activeConversationId = null,
  onSelectConversation,
  onNewConversation,
  onRenameConversation,
  onDeleteConversation,
  sending,
  sendingLabel,
  text,
  image,
  selected,
  activeAnnotation,
  canApplyStyles = false,
  styleId,
  styles,
  variants,
  fileRef,
  chatEndRef,
  onTextChange,
  onStyleChange,
  onVariantsChange,
  onRemoveImage,
  onRemoveSelected,
  onClearSelected,
  onCommentChange,
  onFocusAnnotation,
  onApplyStyles,
  onSend,
  onSelectVariant,
  onDismissMessage,
  piModels = [],
  piDefaults = {},
  piModel = "__default__",
  piThinking = "__default__",
  onPiModelChange,
  onPiThinkingChange,
  readOnly = false,
}) {
  return (
    <aside className="conversation-panel" aria-label="设计对话">
      <div className="conversation-header">
        <div className="conversation-header-copy">
          <h2>设计对话</h2>
          <p>{readOnly ? "Viewer 权限 · 可查看但不能修改" : sending ? sendingLabel : current ? `${current.meta.title} · v${current.version}` : "描述你的页面目标"}</p>
        </div>
        <Badge variant={sending ? "secondary" : "outline"}>
          {sending ? "任务执行中" : current ? "可继续迭代" : "新建模式"}
        </Badge>
      </div>

      {current && !readOnly ? (
        <SessionSwitcher
          conversations={conversations}
          activeConversationId={activeConversationId}
          onSelect={onSelectConversation}
          onNew={onNewConversation}
          onRename={onRenameConversation}
          onDelete={onDeleteConversation}
          disabled={sending}
        />
      ) : null}

      <ScrollArea className="conversation-scroll">
        <div className="conversation-list">
          {messages.map((message, index) => (
            <ConversationMessage
              key={message.id || `${message.role}-${index}-${message.text}`}
              message={message}
              onSelectVariant={onSelectVariant}
              onDismiss={onDismissMessage}
            />
          ))}
          <div ref={chatEndRef} />
        </div>
      </ScrollArea>

      <div className="composer-shell">
        {image ? (
          <div className="context-row">
            <ContextChip icon={ImageIcon} onRemove={onRemoveImage}>参考截图已附加</ContextChip>
          </div>
        ) : null}
        {selected?.length && !image ? (
          <div className="annotation-list">
            <div className="annotation-list-head">
              <span className="annotation-list-title">
                <MousePointer2Icon data-icon="inline-start" />
                已标注 {selected.length} 个元素
              </span>
              <button type="button" className="annotation-clear" onClick={onClearSelected}>
                清空
              </button>
            </div>
            {selected.map((item, index) => {
              const styleCount = countStyleEdits(item);
              const isActive = sameAnnotation(item, activeAnnotation);
              return (
                <div
                  className={cn("annotation-item", isActive && "annotation-item-active")}
                  key={`${item.file}:${item.line}:${item.column}:${index}`}
                >
                  <div
                    className="annotation-item-head"
                    role="button"
                    tabIndex={0}
                    onClick={() => onFocusAnnotation?.(item)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onFocusAnnotation?.(item);
                      }
                    }}
                  >
                    <Badge variant={isActive ? "default" : "secondary"} className="annotation-index">
                      {index + 1}
                    </Badge>
                    <span className="annotation-target truncate">
                      {item.component || item.tagName} · {item.file}:{item.line}
                    </span>
                    {styleCount ? (
                      <Badge variant="outline" className="annotation-style-chip">
                        <PaletteIcon data-icon="inline-start" />
                        {styleCount}
                      </Badge>
                    ) : null}
                    <button
                      type="button"
                      className="annotation-remove"
                      aria-label="移除该标注"
                      onClick={(event) => {
                        event.stopPropagation();
                        onRemoveSelected(item);
                      }}
                    >
                      <XIcon />
                    </button>
                  </div>
                </div>
              );
            })}
            {canApplyStyles ? (
              <Button
                variant="outline"
                className="annotation-apply-styles"
                disabled={sending || readOnly}
                onClick={onApplyStyles}
              >
                <PaletteIcon data-icon="inline-start" />
                应用样式修改
              </Button>
            ) : null}
          </div>
        ) : null}
        <div className="composer">
          <Textarea
            value={text}
            onChange={(event) => onTextChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSend();
              }
            }}
            placeholder={
              selected?.length && !image
                ? "整体说明（可选），或直接为每个元素填写标注…"
                : current
                  ? "描述下一步修改…"
                  : "例如：为独立开发者做一个克制、有编辑感的产品发布页"
            }
            disabled={sending || readOnly}
            className="composer-textarea"
            aria-label="设计需求"
          />
          <div className="composer-actions">
            <Tooltip>
              <TooltipTrigger
                render={<Button variant="ghost" size="icon" disabled={sending || !current || readOnly} aria-label="附加参考截图" />}
                onClick={() => fileRef.current?.click()}
              >
                <PaperclipIcon />
              </TooltipTrigger>
              <TooltipContent>附加参考截图</TooltipContent>
            </Tooltip>
            {current ? (
              <PiOptions
                models={piModels}
                defaults={piDefaults}
                model={piModel}
                thinking={piThinking}
                disabled={sending || readOnly}
                onModelChange={onPiModelChange}
                onThinkingChange={onPiThinkingChange}
              />
            ) : (
              <div className="generation-options">
                <Select value={styleId} disabled={sending} onValueChange={onStyleChange}>
                  <SelectTrigger><SelectValue placeholder="默认风格" /></SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="__default__">智能匹配风格</SelectItem>
                      {styles.map((style) => <SelectItem key={style.id} value={style.id}>{style.name}</SelectItem>)}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <Select value={variants} disabled={sending} onValueChange={onVariantsChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="1">1 个方案</SelectItem>
                      <SelectItem value="2">2 个方案</SelectItem>
                      <SelectItem value="3">3 个方案</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button
              size="icon-lg"
              className="ml-auto"
              disabled={sending || readOnly || (!text.trim() && !(selected?.length && !image && selected.some((item) => item.comment?.trim())))}
              aria-label={sending ? sendingLabel : "发送"}
              aria-busy={sending}
              onClick={onSend}
            >
              {sending ? <Spinner /> : <ArrowUpIcon />}
            </Button>
          </div>
        </div>
        <p className="composer-hint">Enter 发送 · Shift + Enter 换行 · 可直接粘贴截图</p>
      </div>
    </aside>
  );
}
