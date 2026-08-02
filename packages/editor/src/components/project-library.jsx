import { FolderOpenIcon, SearchIcon } from "lucide-react";
import { DesignThumbnail } from "@/components/design-preview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { filterProjects, groupProjectsByActivity } from "@/lib/projects";

function relativeDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知时间";
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(date);
}

function ProjectRow({ project, onOpen }) {
  return (
    <Button variant="ghost" className="project-library-item" onClick={() => onOpen(project.id)}>
      <DesignThumbnail meta={project.design} compact />
      <span className="project-library-copy">
        <strong>{project.title}</strong>
        <span className="flex items-center gap-2">
          {project.variantCount} 个方案 · {relativeDate(project.updatedAt)}
          {project.role ? <Badge variant="outline">{project.role}</Badge> : null}
        </span>
      </span>
    </Button>
  );
}

export function ProjectLibrary({ projects, query, loading, error, onQueryChange, onOpen, onRetry }) {
  const visible = filterProjects(projects, query);
  const groups = groupProjectsByActivity(visible);

  return (
    <aside className="project-library" aria-label="项目库">
      <div className="project-library-tabs">
        <span className="active"><FolderOpenIcon />我的项目</span>
        <span>协作项目</span>
      </div>
      <label className="project-search">
        <SearchIcon />
        <Input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索项目"
          aria-label="搜索项目"
        />
      </label>
      <div className="project-library-scroll">
        {loading ? (
          <div className="project-library-skeleton" aria-label="正在载入项目">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index}><Skeleton className="size-11" /><span><Skeleton /><Skeleton /></span></div>
            ))}
          </div>
        ) : error ? (
          <div className="project-library-state">
            <p>{error}</p>
            <Button variant="outline" size="sm" onClick={onRetry}>重新载入</Button>
          </div>
        ) : groups.length ? groups.map((group) => (
          <section className="project-group" key={group.label}>
            <h2>{group.label}</h2>
            <div>
              {group.projects.map((project) => (
                <ProjectRow key={project.id} project={project} onOpen={onOpen} />
              ))}
            </div>
          </section>
        )) : (
          <div className="project-library-state">
            <FolderOpenIcon />
            <p>{query ? "没有匹配的项目" : "还没有项目，从右侧开始设计。"}</p>
          </div>
        )}
      </div>
    </aside>
  );
}
