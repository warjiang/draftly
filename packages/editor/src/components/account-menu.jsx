import { useCallback, useEffect, useState } from "react";
import { BellIcon, LogOutIcon } from "lucide-react";
import { api } from "@/lib/api";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { toast } from "@/components/ui/toast";

export function AccountMenu({ user, onSignOut, onProjectsChanged }) {
  const [invitations, setInvitations] = useState([]);

  const load = useCallback(() => {
    api("/api/invitations", { method: "GET" })
      .then((result) => setInvitations(result.invitations || []))
      .catch(() => setInvitations([]));
  }, []);

  useEffect(load, [load]);

  const respond = useCallback(async (id, action) => {
    try {
      await api(`/api/invitations/${encodeURIComponent(id)}/${action}`, { body: {} });
      load();
      onProjectsChanged?.();
      toast.add({ title: action === "accept" ? "已加入项目" : "已拒绝邀请", type: "success" });
    } catch (error) {
      toast.add({ title: "无法处理邀请", description: error.message, type: "error" });
    }
  }, [load, onProjectsChanged]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" className="account-trigger" />}>
        <Avatar size="sm">
          <AvatarImage src={user.image || undefined} alt={user.name} />
          <AvatarFallback>{user.githubLogin.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <span>@{user.githubLogin}</span>
        {invitations.length ? <Badge variant="secondary">{invitations.length}</Badge> : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuGroup>
          <DropdownMenuLabel>项目邀请</DropdownMenuLabel>
          {invitations.length ? invitations.map((invitation) => (
            <DropdownMenuItem key={invitation.id} closeOnClick={false} className="items-start">
              <BellIcon />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <strong className="truncate">{invitation.projectTitle}</strong>
                <span className="text-xs text-muted-foreground">
                  {invitation.inviterName} 邀请你成为 {invitation.role}
                </span>
                <span className="flex gap-2">
                  <Button size="xs" onClick={() => respond(invitation.id, "accept")}>接受</Button>
                  <Button size="xs" variant="ghost" onClick={() => respond(invitation.id, "decline")}>拒绝</Button>
                </span>
              </span>
            </DropdownMenuItem>
          )) : (
            <DropdownMenuItem disabled>没有待处理邀请</DropdownMenuItem>
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={onSignOut}>
            <LogOutIcon />
            退出登录
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
