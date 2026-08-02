import { useCallback, useEffect, useRef, useState } from "react";
import { HomeComposer } from "@/components/home-composer";
import { ProjectLibrary } from "@/components/project-library";
import { AccountMenu } from "@/components/account-menu";
import { Toaster, toast } from "@/components/ui/toast";
import { api, apiStream } from "@/lib/api";
import { projectPath } from "@/lib/router";

function progressLabel(event) {
  const labels = {
    variant_started: `正在准备方案 ${event.variant || 1}`,
    scaffold_started: "正在创建 React 项目",
    dependencies_started: "正在安装项目依赖",
    agent_started: "设计代理正在编写界面",
    validation_started: "正在验证生成结果",
    commit_started: "正在保存项目版本",
    variant_completed: `方案 ${event.variant || 1} 已完成`,
  };
  return labels[event.stage] || "正在生成可运行的视觉方案";
}

export function HomePage({ user, onSignOut, onNavigate }) {
  const [projects, setProjects] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [prompt, setPrompt] = useState("");
  const [variants, setVariants] = useState("3");
  const [selectedDesign, setSelectedDesign] = useState({ type: "template", id: "vercel" });
  const [importedDesign, setImportedDesign] = useState(null);
  const [importError, setImportError] = useState("");
  const [sending, setSending] = useState(false);
  const [progressText, setProgressText] = useState("正在准备项目");
  const fileRef = useRef(null);

  const loadHome = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [projectResult, templateResult] = await Promise.allSettled([
        api("/api/projects", { method: "GET" }),
        api("/api/templates", { method: "GET" }),
      ]);
      if (projectResult.status === "fulfilled") {
        setProjects(projectResult.value.projects || []);
      } else {
        setProjects([]);
        setLoadError(projectResult.reason.message);
      }
      const nextTemplates = templateResult.status === "fulfilled"
        ? templateResult.value.templates || []
        : [];
      setTemplates(nextTemplates);
      if (templateResult.status === "rejected") {
        toast.add({ title: "无法载入 DESIGN.md 模板", description: templateResult.reason.message, type: "error" });
      }
      if (!nextTemplates.some((template) => template.id === "vercel")) {
        const first = nextTemplates[0];
        setSelectedDesign(first ? { type: "template", id: first.id } : { type: "default" });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHome();
  }, [loadHome]);

  const importDesign = useCallback(async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const clearImportedDesign = () => {
      setImportedDesign(null);
      setSelectedDesign(templates[0] ? { type: "template", id: templates[0].id } : { type: "default" });
    };
    if (file.size > 200_000) {
      clearImportedDesign();
      setImportError("文件超过 200 KB，请精简后重试。");
      return;
    }
    try {
      const content = await file.text();
      const result = await api("/api/designs/validate", { body: { content } });
      if (!result.valid) {
        clearImportedDesign();
        setImportError(result.errors.join("；"));
        return;
      }
      setImportedDesign({
        name: result.meta?.name || file.name.replace(/\.md$/i, ""),
        fileName: file.name,
        content,
        meta: result.meta || {},
      });
      setSelectedDesign({ type: "import" });
      setImportError("");
    } catch (error) {
      clearImportedDesign();
      setImportError(error.message);
    }
  }, [templates]);

  const generate = useCallback(async () => {
    const message = prompt.trim();
    if (!message || sending) return;
    const body = { prompt: message, variants: Number(variants) };
    if (selectedDesign.type === "template") body.templateId = selectedDesign.id;
    if (selectedDesign.type === "import" && importedDesign) {
      body.designMd = importedDesign.content;
      body.designName = importedDesign.name;
    }
    setSending(true);
    setProgressText("正在准备项目");
    try {
      const result = await apiStream("/api/projects/generate", body, (event) => {
        if (event.type === "pipeline") setProgressText(progressLabel(event));
      });
      onNavigate(projectPath(result.project.id));
    } catch (error) {
      toast.add({ title: "项目生成失败", description: error.message, type: "error" });
    } finally {
      setSending(false);
    }
  }, [importedDesign, onNavigate, prompt, selectedDesign, sending, variants]);

  return (
    <div className="home-root">
      <header className="home-header">
        <a className="home-brand" href="/" onClick={(event) => {
          event.preventDefault();
          onNavigate("/");
        }}>
          <span>draftly</span>
          <small>LOCAL PROTOTYPE STUDIO</small>
        </a>
        <p>项目优先的 AI 视觉工作区</p>
        <AccountMenu user={user} onSignOut={onSignOut} onProjectsChanged={loadHome} />
      </header>
      <main className="home-layout">
        <ProjectLibrary
          projects={projects}
          query={query}
          loading={loading}
          error={loadError}
          onQueryChange={setQuery}
          onOpen={(id) => onNavigate(projectPath(id))}
          onRetry={loadHome}
        />
        <HomeComposer
          prompt={prompt}
          variants={variants}
          templates={templates}
          selectedDesign={selectedDesign}
          importedDesign={importedDesign}
          importError={importError}
          sending={sending}
          progressText={progressText}
          fileRef={fileRef}
          onPromptChange={setPrompt}
          onVariantsChange={setVariants}
          onSelectDesign={setSelectedDesign}
          onImport={importDesign}
          onRemoveImport={() => {
            setImportedDesign(null);
            setSelectedDesign(templates[0] ? { type: "template", id: templates[0].id } : { type: "default" });
          }}
          onGenerate={generate}
        />
      </main>
      <Toaster />
    </div>
  );
}
