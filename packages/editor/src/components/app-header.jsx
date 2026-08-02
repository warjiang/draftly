import {
  ArrowLeftIcon,
  ChevronDownIcon,
  Clock3Icon,
  FilePlus2Icon,
  Layers3Icon,
  UsersIcon,
  SparklesIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AccountMenu } from "@/components/account-menu";

function DraftItem({ draft, index, active, onSelect }) {
  return (
    <DropdownMenuItem className="items-start py-2.5" onClick={() => onSelect(draft.id)}>
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Layers3Icon />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium">方案 {index + 1}</span>
          {active ? <Badge variant="secondary">当前</Badge> : null}
        </span>
        <span className="text-xs text-muted-foreground">
          v{draft.versions?.length || 0} · {new Date(draft.createdAt).toLocaleDateString()}
        </span>
      </span>
    </DropdownMenuItem>
  );
}

export function AppHeader({
  project,
  current,
  drafts,
  sending,
  user,
  onSignOut,
  onSelectDraft,
  onHome,
  onNewProject,
  onHistory,
  onMembers,
}) {
  return (
    <header className="app-header">
      <a className="skip-link" href="#workspace-main">跳到工作区</a>
      <Button variant="ghost" size="icon" aria-label="返回项目首页" onClick={onHome}>
        <ArrowLeftIcon />
      </Button>
      <button type="button" className="brand-lockup" aria-label="返回 Draftly 首页" onClick={onHome}>
        <span className="brand-mark"><SparklesIcon /></span>
        <span className="brand-copy">
          <strong>draftly</strong>
          <span>prototype studio</span>
        </span>
      </button>

      <div className="header-divider" />

      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={sending}
          render={<Button variant="ghost" className="draft-switcher" />}
        >
          <span className="flex min-w-0 flex-col items-start">
            <span className="text-[11px] font-medium text-muted-foreground">{project?.title || "项目"}</span>
            <span className="max-w-48 truncate">
              方案 {Math.max(1, drafts.findIndex((draft) => draft.id === current?.meta?.id) + 1)}
            </span>
          </span>
          <ChevronDownIcon data-icon="inline-end" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-72" align="start" sideOffset={8}>
          <DropdownMenuGroup>
            <DropdownMenuLabel>项目方案</DropdownMenuLabel>
            {drafts.map((draft, index) => (
              <DraftItem
                key={draft.id}
                draft={draft}
                index={index}
                active={current?.meta?.id === draft.id}
                onSelect={onSelectDraft}
              />
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="ml-auto flex items-center gap-2">
        {project?.role === "viewer" ? <Badge variant="outline">只读</Badge> : null}
        {project?.role === "owner" ? (
          <Button variant="ghost" onClick={onMembers}>
            <UsersIcon data-icon="inline-start" />
            <span className="hidden sm:inline">成员</span>
          </Button>
        ) : null}
        <Button variant="ghost" disabled={!current} onClick={onHistory}>
          <Clock3Icon data-icon="inline-start" />
          <span className="hidden sm:inline">版本历史</span>
        </Button>
        <Button disabled={sending} onClick={onNewProject}>
          <FilePlus2Icon data-icon="inline-start" />
          新项目
        </Button>
        <AccountMenu user={user} onSignOut={onSignOut} />
      </div>
    </header>
  );
}
