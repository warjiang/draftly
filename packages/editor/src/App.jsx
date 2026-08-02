import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { LoginPage } from "@/components/login-page";
import { api } from "@/lib/api";
import { HomePage } from "@/pages/home-page";
import { ProjectWorkspace } from "@/pages/project-workspace";
import { routeForPath } from "@/lib/router";
import "./App.css";

export default function App() {
  const [route, setRoute] = useState(() => routeForPath(window.location.pathname));
  const [auth, setAuth] = useState({ loading: true, user: null, error: "" });

  const loadUser = useCallback(() => {
    setAuth((value) => ({ ...value, loading: true, error: "" }));
    api("/api/me", { method: "GET" })
      .then(({ user }) => setAuth({ loading: false, user, error: "" }))
      .catch((error) => setAuth({
        loading: false,
        user: null,
        error: error.status === 401 ? "" : error.message,
      }));
  }, []);

  useEffect(loadUser, [loadUser]);

  useEffect(() => {
    const onPopState = () => setRoute(routeForPath(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((path, { replace = false } = {}) => {
    const method = replace ? "replaceState" : "pushState";
    window.history[method]({}, "", path);
    setRoute(routeForPath(window.location.pathname));
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  const login = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/sign-in/social", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ provider: "github", callbackURL: window.location.href }),
      });
      const data = await response.json();
      if (!response.ok || !data.url) throw new Error(data.message || data.error || "无法开始 GitHub 登录");
      window.location.assign(data.url);
    } catch (error) {
      setAuth((value) => ({ ...value, error: error.message }));
    }
  }, []);

  const signOut = useCallback(async () => {
    await api("/api/auth/sign-out", { body: {} });
    setAuth({ loading: false, user: null, error: "" });
    navigate("/", { replace: true });
  }, [navigate]);

  if (auth.loading) return <main className="workspace-route-state"><span>AUTHENTICATING</span><h1>正在恢复账号会话</h1></main>;
  if (!auth.user) return <LoginPage error={auth.error} onLogin={login} />;
  if (route.name === "home") {
    return <HomePage user={auth.user} onSignOut={signOut} onNavigate={navigate} />;
  }
  if (route.name === "project") {
    return <ProjectWorkspace key={route.projectId} user={auth.user} onSignOut={signOut} projectId={route.projectId} onNavigate={navigate} />;
  }
  return (
    <main className="route-not-found">
      <span>404</span>
      <h1>这个工作区不存在</h1>
      <p>地址可能已经变化，返回项目首页重新选择。</p>
      <Button onClick={() => navigate("/", { replace: true })}>返回项目首页</Button>
    </main>
  );
}
