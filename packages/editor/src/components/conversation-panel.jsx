import {
  ArrowUpIcon,
  CheckIcon,
  CircleAlertIcon,
  ImageIcon,
  MousePointer2Icon,
  PaperclipIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { groupProgressSteps } from "@/lib/progress";

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
                      <div key={child.key} className={cn("progress-step progress-child", child.status)}>
                        <span className="progress-icon">
                          {child.status === "done" ? <CheckIcon /> : <span className="progress-dot" />}
                        </span>
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
  );
}

function SystemMessage({ text }) {
  return (
    <div className="system-message">
      <SparklesIcon />
      <span>{text}</span>
    </div>
  );
}

function UserMessage({ message }) {
  return (
    <div className="message-row message-user">
      <div className="message-bubble user-bubble">
        {message.image ? <img className="message-image" src={message.image} alt="参考截图" /> : null}
        {message.locator ? (
          <div className="message-context">
            <MousePointer2Icon />
            {message.locator.component || message.locator.tagName} · {message.locator.file}:{message.locator.line}
          </div>
        ) : null}
        <p>{message.text}</p>
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

  return (
    <div className="message-row message-assistant">
      <Card size="sm" className="assistant-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {message.kind === "pending" ? <Spinner /> : <SparklesIcon />}
            <span>{message.text.replace(/^✓\s*/, "")}</span>
            {message.kind === "pending" ? <Badge variant="secondary">运行中</Badge> : null}
          </CardTitle>
        </CardHeader>
        {message.steps?.length || message.variants?.length ? (
          <CardContent className="flex flex-col gap-3">
            {message.steps?.length ? <ProgressTree steps={message.steps} /> : null}
            {message.variants?.length ? (
              <div className="variant-list">
                {message.variants.map((variant) => (
                  <Button
                    key={variant.id}
                    variant={variant.chosen ? "default" : "outline"}
                    className="justify-start"
                    onClick={() => onSelectVariant(variant.id)}
                  >
                    方案 {variant.index}
                    <span className="truncate text-left">{variant.title}</span>
                  </Button>
                ))}
              </div>
            ) : null}
          </CardContent>
        ) : null}
      </Card>
    </div>
  );
}

function ConversationMessage({ message, onSelectVariant }) {
  if (message.role === "system") return <SystemMessage text={message.text} />;
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

export function ConversationPanel({
  current,
  messages,
  sending,
  sendingLabel,
  text,
  image,
  selected,
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
  onSend,
  onSelectVariant,
  readOnly = false,
}) {
  return (
    <aside className="conversation-panel" aria-label="设计对话">
      <div className="conversation-header">
        <div>
          <h2>设计对话</h2>
          <p>{readOnly ? "Viewer 权限 · 可查看但不能修改" : sending ? sendingLabel : current ? `${current.meta.title} · v${current.version}` : "描述你的页面目标"}</p>
        </div>
        <Badge variant={sending ? "secondary" : "outline"}>
          {sending ? "任务执行中" : current ? "可继续迭代" : "新建模式"}
        </Badge>
      </div>

      <ScrollArea className="conversation-scroll">
        <div className="conversation-list">
          {messages.map((message, index) => (
            <ConversationMessage
              key={message.id || `${message.role}-${index}-${message.text}`}
              message={message}
              onSelectVariant={onSelectVariant}
            />
          ))}
          <div ref={chatEndRef} />
        </div>
      </ScrollArea>

      <div className="composer-shell">
        {image || selected ? (
          <div className="context-row">
            {image ? (
              <ContextChip icon={ImageIcon} onRemove={onRemoveImage}>参考截图已附加</ContextChip>
            ) : null}
            {selected ? (
              <ContextChip icon={MousePointer2Icon} onRemove={onRemoveSelected}>
                {selected.component || selected.tagName} · {selected.file}:{selected.line}
              </ContextChip>
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
            placeholder={current ? "描述下一步修改…" : "例如：为独立开发者做一个克制、有编辑感的产品发布页"}
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
            {!current ? (
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
            ) : null}
            <Button
              size="icon-lg"
              className="ml-auto"
              disabled={sending || readOnly || !text.trim()}
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
