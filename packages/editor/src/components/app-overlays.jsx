import { RotateCcwIcon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export function AppOverlays({
  current,
  versions,
  historyOpen,
  rollbackVersion,
  onHistoryChange,
  onRollbackRequest,
  onRollbackCancel,
  onRollbackConfirm,
  canRollback = true,
}) {
  return (
    <>
      <Sheet open={historyOpen} onOpenChange={onHistoryChange}>
        <SheetContent side="right" className="history-sheet">
          <SheetHeader className="border-b">
            <SheetTitle>版本历史</SheetTitle>
            <p className="text-sm text-muted-foreground">回退会创建新版本，不会删除现有记录。</p>
          </SheetHeader>
          <ScrollArea className="min-h-0 flex-1">
            <div className="version-list">
              {versions.map((version) => {
                const active = version.v === current?.version;
                return (
                  <div key={version.v} className={cn("version-item", active && "active")}>
                    <div className="version-head">
                      <div className="flex items-center gap-2">
                        <span className="version-number">v{version.v}</span>
                        {active ? <Badge variant="secondary">当前</Badge> : null}
                      </div>
                      {!active && canRollback ? (
                        <Button size="sm" variant="ghost" onClick={() => onRollbackRequest(version.v)}>
                          <RotateCcwIcon data-icon="inline-start" />
                          回退
                        </Button>
                      ) : null}
                    </div>
                    <p className="version-sub">{version.instruction || new Date(version.at).toLocaleString()}</p>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      <AlertDialog open={rollbackVersion !== null} onOpenChange={(open) => {
        if (!open) onRollbackCancel();
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia><RotateCcwIcon /></AlertDialogMedia>
            <AlertDialogTitle>基于 v{rollbackVersion} 创建回退版本？</AlertDialogTitle>
            <AlertDialogDescription>
              当前历史会完整保留，Draftly 将把该版本的文件恢复为一个新的最新版本。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={onRollbackConfirm}>确认回退</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
