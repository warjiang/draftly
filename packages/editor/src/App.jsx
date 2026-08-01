import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { HomePage } from "@/pages/home-page";
import { ProjectWorkspace } from "@/pages/project-workspace";
import { routeForPath } from "@/lib/router";
import "./App.css";

export default function App() {
  const [route, setRoute] = useState(() => routeForPath(window.location.pathname));

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

  if (route.name === "home") return <HomePage onNavigate={navigate} />;
  if (route.name === "project") {
    return <ProjectWorkspace key={route.projectId} projectId={route.projectId} onNavigate={navigate} />;
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
