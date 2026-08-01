const PROJECT_PATH = /^\/projects\/([a-z0-9][a-z0-9-]*)\/?$/;

export function routeForPath(pathname) {
  if (pathname === "/" || pathname === "") return { name: "home" };
  const project = PROJECT_PATH.exec(pathname);
  if (project) return { name: "project", projectId: project[1] };
  return { name: "not-found" };
}

export function projectPath(projectId) {
  return `/projects/${encodeURIComponent(projectId)}`;
}
