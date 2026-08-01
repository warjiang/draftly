import fs from 'node:fs/promises';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';

const traverse = traverseModule.default || traverseModule;

function contains(node, line, column) {
  if (!node.loc) return false;
  const startsBefore = node.loc.start.line < line
    || (node.loc.start.line === line && node.loc.start.column <= column);
  const endsAfter = node.loc.end.line > line
    || (node.loc.end.line === line && node.loc.end.column >= column);
  return startsBefore && endsAfter;
}

function componentPath(path) {
  return path.findParent((candidate) => {
    if (candidate.isFunctionDeclaration()) return true;
    if (!candidate.isArrowFunctionExpression() && !candidate.isFunctionExpression()) return false;
    return candidate.parentPath?.isVariableDeclarator();
  });
}

function componentName(path) {
  if (!path) return null;
  if (path.isFunctionDeclaration()) return path.node.id?.name || null;
  const declarator = path.parentPath?.node;
  return declarator?.id?.type === 'Identifier' ? declarator.id.name : null;
}

export async function sourceContextForLocator({ drafts, id, locator }) {
  if (!locator || !Number.isInteger(locator.line) || !Number.isInteger(locator.column)) {
    const error = new Error('valid source locator required');
    error.status = 400;
    throw error;
  }
  const sourceResult = await drafts.readSource(id, locator.file);
  const source = sourceResult.source;
  const ast = parse(source, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript'],
    errorRecovery: false,
  });
  let selected = null;
  let owner = null;
  traverse(ast, {
    JSXElement(path) {
      if (!contains(path.node, locator.line, locator.column)) return;
      if (!selected || (path.node.end - path.node.start) < (selected.node.end - selected.node.start)) {
        selected = path;
        owner = componentPath(path);
      }
    },
    JSXFragment(path) {
      if (!contains(path.node, locator.line, locator.column)) return;
      if (!selected || (path.node.end - path.node.start) < (selected.node.end - selected.node.start)) {
        selected = path;
        owner = componentPath(path);
      }
    },
  });
  if (!selected) {
    const error = new Error(`source element not found at ${locator.file}:${locator.line}:${locator.column}`);
    error.status = 404;
    throw error;
  }

  const imports = ast.program.body
    .filter((node) => node.type === 'ImportDeclaration')
    .map((node) => source.slice(node.start, node.end))
    .join('\n');
  const selectedSource = source.slice(selected.node.start, selected.node.end);
  const ownerSource = owner ? source.slice(owner.node.start, owner.node.end) : selectedSource;
  const context = [
    `File: ${sourceResult.file}:${locator.line}:${locator.column}`,
    `Component: ${componentName(owner) || locator.component || 'unknown'}`,
    `Rendered element: <${locator.tagName || locator.jsxName || 'unknown'}>`,
    locator.text ? `Rendered text: ${locator.text}` : '',
    locator.styles ? `Computed style summary: ${JSON.stringify(locator.styles)}` : '',
    `Imports:\n${imports}`,
    `Selected JSX:\n${selectedSource}`,
    `Owning component:\n${ownerSource.slice(0, 30_000)}`,
  ].filter(Boolean).join('\n\n');

  return {
    ...sourceResult,
    component: componentName(owner) || locator.component || null,
    selectedSource,
    componentSource: ownerSource,
    context,
  };
}

export async function assertNoEscapingSymlinks(projectDir) {
  const realProject = await fs.realpath(projectDir);
  const visit = async (directory) => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const full = `${directory}/${entry.name}`;
      if (entry.isSymbolicLink()) {
        const target = await fs.realpath(full);
        if (target !== realProject && !target.startsWith(`${realProject}/`)) {
          throw new Error(`draft contains an escaping symlink: ${full}`);
        }
      } else if (entry.isDirectory()) {
        await visit(full);
      }
    }
  };
  await visit(realProject);
}
