import {
  ArrowUpIcon,
  CheckIcon,
  FileTextIcon,
  PlusIcon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { DesignThumbnail } from "@/components/design-preview";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export function HomeComposer({
  prompt,
  variants,
  templates,
  selectedDesign,
  importedDesign,
  importError,
  sending,
  progressText,
  fileRef,
  onPromptChange,
  onVariantsChange,
  onSelectDesign,
  onImport,
  onRemoveImport,
  onGenerate,
}) {
  const activeDesign = selectedDesign.type === "import"
    ? importedDesign
    : templates.find((template) => template.id === selectedDesign.id);

  return (
    <section className="home-creation" aria-labelledby="home-title">
      <div className="home-intro">
        <Badge variant="outline">LOCAL AI PROTOTYPING</Badge>
        <h1 id="home-title">从项目开始，<br />让视觉方向先成形。</h1>
        <p>选择一套 DESIGN.md，描述页面目标。Draftly 会生成可运行的 React 方案，并把每次修改留在项目历史中。</p>
      </div>

      <div className={cn("home-prompt-shell", sending && "is-sending")}>
        <Textarea
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onGenerate();
            }
          }}
          disabled={sending}
          placeholder="例如：为本地优先的开发工具设计一个清晰、克制的项目概览页"
          aria-label="新项目需求"
          className="home-prompt-input"
        />
        {activeDesign ? (
          <div className="active-design-chip">
            <FileTextIcon />
            <span>{activeDesign.name}</span>
            {selectedDesign.type === "import" ? (
              <button type="button" onClick={onRemoveImport} aria-label="移除导入的 DESIGN.md"><XIcon /></button>
            ) : null}
          </div>
        ) : null}
        <div className="home-prompt-actions">
          <Button
            variant="ghost"
            size="icon"
            disabled={sending}
            aria-label="导入本地 DESIGN.md"
            onClick={() => fileRef.current?.click()}
          >
            <PlusIcon />
          </Button>
          <span className="home-prompt-mode"><FileTextIcon />Web</span>
          <Select value={variants} disabled={sending} onValueChange={onVariantsChange}>
            <SelectTrigger className="home-variant-select"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="1">1 个方案</SelectItem>
                <SelectItem value="2">2 个方案</SelectItem>
                <SelectItem value="3">3 个方案</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button
            size="icon-lg"
            disabled={sending || !prompt.trim() || (selectedDesign.type === "import" && !importedDesign)}
            aria-label={sending ? "正在生成" : "生成项目"}
            onClick={onGenerate}
          >
            {sending ? <Spinner /> : <ArrowUpIcon />}
          </Button>
        </div>
        {sending ? <p className="home-progress"><Spinner />{progressText}</p> : null}
      </div>

      {importError ? (
        <Alert variant="destructive" className="home-import-error">
          <FileTextIcon />
          <AlertTitle>无法使用这个 DESIGN.md</AlertTitle>
          <AlertDescription>{importError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="design-picker-head">
        <div>
          <span>DESIGN SYSTEMS</span>
          <h2>切换视觉基础</h2>
        </div>
        <Button variant="ghost" onClick={() => fileRef.current?.click()}>
          <UploadIcon data-icon="inline-start" />
          导入 DESIGN.md
        </Button>
      </div>
      <div className="design-picker" role="list" aria-label="设计系统">
        {importedDesign ? (
          <button
            type="button"
            className={cn("design-option", selectedDesign.type === "import" && "active")}
            onClick={() => onSelectDesign({ type: "import" })}
          >
            <DesignThumbnail meta={importedDesign.meta} />
            <span><strong>{importedDesign.name}</strong><small>本地导入</small></span>
            {selectedDesign.type === "import" ? <CheckIcon /> : null}
          </button>
        ) : null}
        {templates.map((template) => (
          <button
            type="button"
            className={cn(
              "design-option",
              selectedDesign.type === "template" && selectedDesign.id === template.id && "active",
            )}
            key={template.id}
            onClick={() => onSelectDesign({ type: "template", id: template.id })}
          >
            <DesignThumbnail meta={{ colors: template.colors }} />
            <span><strong>{template.name}</strong><small>{template.tags?.style?.slice(0, 2).join(" · ") || "策展模板"}</small></span>
            {selectedDesign.type === "template" && selectedDesign.id === template.id ? <CheckIcon /> : null}
          </button>
        ))}
      </div>
      <input ref={fileRef} hidden type="file" accept=".md,text/markdown,text/plain" onChange={onImport} />
    </section>
  );
}
