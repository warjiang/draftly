import { GitBranchIcon } from "lucide-react";
import { BrandLockup } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function LoginPage({ error, onLogin }) {
  return (
    <main className="login-page">
      <Card className="login-card">
        <CardHeader>
          <BrandLockup className="login-lockup" />
          <CardTitle>登录 Draftly</CardTitle>
          <CardDescription>使用 GitHub 账号进入你的 AI 原型工作区。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button onClick={onLogin}>
            <GitBranchIcon data-icon="inline-start" />
            使用 GitHub 登录
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
