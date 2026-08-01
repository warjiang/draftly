const LANGUAGE_BY_EXTENSION = {
  cjs: "javascript",
  css: "css",
  html: "html",
  js: "javascript",
  json: "json",
  jsx: "javascript",
  md: "markdown",
  mjs: "javascript",
  svg: "html",
  ts: "typescript",
  tsx: "typescript",
  txt: "plaintext",
  yaml: "yaml",
  yml: "yaml",
};

function sortNodes(nodes) {
  return nodes.sort((left, right) => {
    if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

export function buildSourceTree(files = []) {
  const root = [];
  const directories = new Map();

  for (const file of files) {
    const segments = file.path.split("/").filter(Boolean);
    let children = root;
    let parentPath = "";
    segments.forEach((name, index) => {
      const nodePath = parentPath ? `${parentPath}/${name}` : name;
      const isFile = index === segments.length - 1;
      if (isFile) {
        children.push({ type: "file", name, path: nodePath, size: file.size });
      } else {
        let directory = directories.get(nodePath);
        if (!directory) {
          directory = { type: "directory", name, path: nodePath, children: [] };
          directories.set(nodePath, directory);
          children.push(directory);
        }
        children = directory.children;
      }
      parentPath = nodePath;
    });
  }

  const sortTree = (nodes) => {
    sortNodes(nodes);
    for (const node of nodes) {
      if (node.type === "directory") sortTree(node.children);
    }
  };
  sortTree(root);
  return root;
}

export function filterSourceTree(nodes, query) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return nodes;

  const filterNodes = (items, ancestorMatches = false) => items.flatMap((node) => {
    const matches = ancestorMatches || node.path.toLocaleLowerCase().includes(normalized);
    if (node.type === "file") return matches ? [node] : [];
    const children = filterNodes(node.children, matches);
    return children.length ? [{ ...node, children }] : [];
  });

  return filterNodes(nodes);
}

export function defaultSourceFile(files, preferredPath) {
  const paths = new Set(files.map((file) => file.path));
  if (preferredPath && paths.has(preferredPath)) return preferredPath;
  if (paths.has("src/App.tsx")) return "src/App.tsx";
  return files[0]?.path ?? null;
}

export function sourceLanguage(filePath = "") {
  const extension = filePath.split(".").at(-1)?.toLocaleLowerCase();
  return LANGUAGE_BY_EXTENSION[extension] ?? "plaintext";
}

export function sourceParentPaths(filePath = "") {
  const segments = filePath.split("/");
  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join("/"));
}

export function formatSourceSize(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
