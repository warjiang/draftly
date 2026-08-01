import {
  ChevronDownIcon,
  Clock3Icon,
  FilePlus2Icon,
  Layers3Icon,
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function DraftItem({ group, active, onSelect, onLegacy }) {
  const draft = group.latest;
  const versionLabel = draft.format === "html-legacy"
    ? "旧格式 · 待迁移"
    : group.revisionCount > 1
      ? `${group.revisionCount} 个版本 · 最新 v${draft.versions.length}`
      : `v${draft.versions.length}`;

  return (
    <DropdownMenuItem
      className="items-start py-2.5"
      onClick={() => draft.format === "html-legacy" ? onLegacy() : onSelect(draft.id)}
    >
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Layers3Icon />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium">{draft.title}</span>
          {active ? <Badge variant="secondary">当前</Badge> : null}
        </span>
        <span className="text-xs text-muted-foreground">
          {versionLabel}
          {" · "}
          {new Date(draft.createdAt).toLocaleDateString()}
        </span>
      </span>
    </DropdownMenuItem>
  );
}

export function AppHeader({
  current,
  draftGroups,
  sending,
  onSelectDraft,
  onNewDraft,
  onHistory,
  onLegacyDraft,
}) {
  return (
    <header className="app-header">
      <a className="skip-link" href="#workspace-main">跳到工作区</a>
      <div className="brand-lockup" aria-label="Draftly">
        <span className="brand-mark"><SparklesIcon /></span>
        <span className="brand-copy">
          <strong>draftly</strong>
          <span>prototype studio</span>
        </span>
      </div>

      <div className="header-divider" />

      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={sending}
          render={<Button variant="ghost" className="draft-switcher" />}
        >
          <span className="flex min-w-0 flex-col items-start">
            <span className="text-[11px] font-medium text-muted-foreground">当前草稿</span>
            <span className="max-w-48 truncate">{current?.meta?.title || "尚未选择"}</span>
          </span>
          <ChevronDownIcon data-icon="inline-end" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-80" align="start" sideOffset={8}>
          <DropdownMenuGroup>
            <DropdownMenuLabel>草稿库</DropdownMenuLabel>
            {draftGroups.length ? draftGroups.map((group) => (
              <DraftItem
                key={group.key}
                group={group}
                active={group.drafts.some((draft) => current?.meta?.id === draft.id)}
                onSelect={onSelectDraft}
                onLegacy={onLegacyDraft}
              />
            )) : (
              <DropdownMenuItem disabled>还没有草稿</DropdownMenuItem>
            )}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={onNewDraft}>
              <FilePlus2Icon />
              新建草稿
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="ml-auto flex items-center gap-2">
        <Button variant="ghost" disabled={!current} onClick={onHistory}>
          <Clock3Icon data-icon="inline-start" />
          <span className="hidden sm:inline">版本历史</span>
        </Button>
        <Button disabled={sending} onClick={onNewDraft}>
          <FilePlus2Icon data-icon="inline-start" />
          新草稿
        </Button>
      </div>
    </header>
  );
}
