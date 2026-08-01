export function projectActivityGroup(updatedAt, now = new Date()) {
  const value = new Date(updatedAt);
  if (Number.isNaN(value.getTime())) return "更早";
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const activity = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const days = Math.round((today.getTime() - activity.getTime()) / 86_400_000);
  if (days <= 0) return "今天";
  if (days <= 30) return "过去 30 天";
  if (value.getFullYear() === now.getFullYear()) return "今年";
  return "更早";
}

export function groupProjectsByActivity(projects, now = new Date()) {
  const groups = new Map();
  for (const project of projects) {
    const label = projectActivityGroup(project.updatedAt, now);
    const items = groups.get(label) || [];
    items.push(project);
    groups.set(label, items);
  }
  return [...groups.entries()].map(([label, items]) => ({ label, projects: items }));
}

export function filterProjects(projects, query) {
  const normalized = String(query || "").trim().toLocaleLowerCase();
  if (!normalized) return projects;
  return projects.filter((project) => (
    `${project.title} ${project.prompt} ${project.design?.name || ""}`
      .toLocaleLowerCase()
      .includes(normalized)
  ));
}
