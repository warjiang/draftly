import {
  ArrowUpIcon,
  CheckIcon,
  FileTextIcon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { DesignThumbnail } from "@/components/design-preview";
import { DesignSystemView } from "@/components/design-system-view";
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
        <Badge variant="outline">WOVEN CANVAS</Badge>
        <h1 id="home-title">把想法编织成可运行的产品</h1>
        <p>从需求和设计规范开始，生成可协作、可预览、可继续迭代的源码原型。</p>
      </div>

      <div className={cn("home-creator", sending && "is-sending")}>
        <section className="creator-step">
          <span className="creator-node" aria-hidden="true" />
          <div className="creator-step-content">
            <label htmlFor="home-project-prompt">描述你要构建的页面</label>
            <Textarea
              id="home-project-prompt"
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
              className="home-prompt-input"
            />
          </div>
        </section>

        <section className="creator-step">
          <span className="creator-node active" aria-hidden="true" />
          <div className="creator-step-content">
            <div className="creator-step-head">
              <span>选择 DESIGN.md 基础</span>
              <Button variant="ghost" onClick={() => fileRef.current?.click()}>
                <UploadIcon data-icon="inline-start" />导入设计规范
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
                  <DesignThumbnail meta={template.meta || { colors: template.colors }} />
                  <span><strong>{template.name}</strong><small>{template.tags?.style?.slice(0, 2).join(" · ") || "策展模板"}</small></span>
                  {selectedDesign.type === "template" && selectedDesign.id === template.id ? <CheckIcon /> : null}
                </button>
              ))}
            </div>
            {activeDesign ? (
              <div className="active-design-chip">
                <FileTextIcon />
                <span>{activeDesign.name}</span>
                {selectedDesign.type === "import" ? (
                  <button type="button" onClick={onRemoveImport} aria-label="移除导入的 DESIGN.md"><XIcon /></button>
                ) : null}
              </div>
            ) : null}
            {activeDesign?.meta ? (
              <details className="design-detail-disclosure" open>
                <summary>这套设计基础长什么样</summary>
                <DesignSystemView meta={activeDesign.meta} name={activeDesign.name} compact />
              </details>
            ) : null}
          </div>
        </section>

        <section className="creator-step">
          <span className="creator-node" aria-hidden="true" />
          <div className="creator-step-content creator-settings">
            <label>生成方案数</label>
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
          </div>
        </section>

        {importError ? (
          <Alert variant="destructive" className="home-import-error">
            <FileTextIcon />
            <AlertTitle>无法使用这个 DESIGN.md</AlertTitle>
            <AlertDescription>{importError}</AlertDescription>
          </Alert>
        ) : null}

        <footer className="creator-footer">
          <span>输入、规范与方案将保留在项目中</span>
          <Button
            disabled={sending || !prompt.trim() || (selectedDesign.type === "import" && !importedDesign)}
            aria-label={sending ? "正在生成" : `生成 ${variants} 个方案`}
            onClick={onGenerate}
          >
            {sending ? <Spinner /> : <ArrowUpIcon />}
            {sending ? progressText : `生成 ${variants} 个方案`}
          </Button>
        </footer>
      </div>
      <input ref={fileRef} hidden type="file" accept=".md,text/markdown,text/plain" onChange={onImport} />
    </section>
  );
}
