import { useCallback, useEffect, useState } from "react";
import { Trash2Icon, UserPlusIcon } from "lucide-react";
import { api } from "@/lib/api";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";

export function MemberDialog({ projectId, open, onOpenChange }) {
  const [data, setData] = useState({ members: [], invitations: [] });
  const [githubLogin, setGithubLogin] = useState("");
  const [role, setRole] = useState("editor");
  const [sending, setSending] = useState(false);

  const load = useCallback(() => {
    if (!open) return;
    api(`/api/projects/${encodeURIComponent(projectId)}/members`, { method: "GET" })
      .then(setData)
      .catch((error) => toast.add({ title: "无法载入成员", description: error.message, type: "error" }));
  }, [open, projectId]);

  useEffect(load, [load]);

  const invite = useCallback(async () => {
    if (!githubLogin.trim() || sending) return;
    setSending(true);
    try {
      await api(`/api/projects/${encodeURIComponent(projectId)}/invitations`, {
        body: { githubLogin, role },
      });
      setGithubLogin("");
      load();
      toast.add({ title: "邀请已发送", type: "success" });
    } catch (error) {
      toast.add({ title: "邀请失败", description: error.message, type: "error" });
    } finally {
      setSending(false);
    }
  }, [githubLogin, load, projectId, role, sending]);

  const changeRole = useCallback(async (userId, nextRole) => {
    await api(`/api/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      body: { role: nextRole },
    });
    load();
  }, [load, projectId]);

  const remove = useCallback(async (userId) => {
    await api(`/api/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`, {
      method: "DELETE",
    });
    load();
  }, [load, projectId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="member-dialog">
        <DialogHeader>
          <DialogTitle>项目成员</DialogTitle>
          <DialogDescription>按 GitHub 用户名邀请协作者，并管理项目角色。</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="github-login">GitHub 用户名</FieldLabel>
            <div className="flex gap-2">
              <Input id="github-login" value={githubLogin} onChange={(event) => setGithubLogin(event.target.value)} placeholder="octocat" />
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="editor">Editor</SelectItem>
                    <SelectItem value="viewer">Viewer</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Button disabled={sending || !githubLogin.trim()} onClick={invite}>
                <UserPlusIcon data-icon="inline-start" />
                邀请
              </Button>
            </div>
          </Field>
        </FieldGroup>
        <div className="member-list">
          {data.members.map((member) => (
            <div key={member.userId} className="member-row">
              <Avatar>
                <AvatarImage src={member.image || undefined} alt={member.name} />
                <AvatarFallback>{(member.githubLogin || member.name).slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1">
                <strong className="block truncate">{member.name}</strong>
                <small className="text-muted-foreground">@{member.githubLogin}</small>
              </span>
              {member.role === "owner" ? <Badge>Owner</Badge> : (
                <>
                  <Select value={member.role} onValueChange={(value) => changeRole(member.userId, value)}>
                    <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="editor">Editor</SelectItem>
                        <SelectItem value="viewer">Viewer</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <Button variant="ghost" size="icon" aria-label="移除成员" onClick={() => remove(member.userId)}>
                    <Trash2Icon />
                  </Button>
                </>
              )}
            </div>
          ))}
          {data.invitations.map((invitation) => (
            <div key={invitation.id} className="member-row">
              <Avatar><AvatarFallback>{invitation.githubLogin.slice(0, 2).toUpperCase()}</AvatarFallback></Avatar>
              <span className="min-w-0 flex-1">
                <strong className="block truncate">@{invitation.githubLogin}</strong>
                <small className="text-muted-foreground">等待接受邀请</small>
              </span>
              <Badge variant="outline">{invitation.role}</Badge>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
