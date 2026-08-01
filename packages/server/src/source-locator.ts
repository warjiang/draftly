import fs from 'node:fs/promises';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import type { NodePath } from '@babel/traverse';
import type * as t from '@babel/types';
import type { DraftStore } from './drafts.js';
import type { ErrorWithStatus, SourceLocator } from './types.js';

const traverse = traverseModule.default || traverseModule;

function contains(node: t.Node, line: number, column: number): boolean {
  if (!node.loc) return false;
  const startsBefore = node.loc.start.line < line
    || (node.loc.start.line === line && node.loc.start.column <= column);
  const endsAfter = node.loc.end.line > line
    || (node.loc.end.line === line && node.loc.end.column >= column);
  return startsBefore && endsAfter;
}

function componentPath(path: NodePath): NodePath | null {
  return path.findParent((candidate) => {
    if (candidate.isFunctionDeclaration()) return true;
    if (!candidate.isArrowFunctionExpression() && !candidate.isFunctionExpression()) return false;
    return candidate.parentPath?.isVariableDeclarator();
  });
}

function componentName(nodePath: NodePath | null): string | null {
  if (!nodePath) return null;
  if (nodePath.isFunctionDeclaration()) return nodePath.node.id?.name || null;
  const declarator = nodePath.parentPath?.node;
  return declarator?.type === 'VariableDeclarator' && declarator.id.type === 'Identifier'
    ? declarator.id.name
    : null;
}

export async function sourceContextForLocator({
  drafts,
  id,
  locator,
}: {
  drafts: DraftStore;
  id: string;
  locator: SourceLocator;
}): Promise<Awaited<ReturnType<DraftStore['readSource']>> & {
  component: string | null;
  selectedSource: string;
  componentSource: string;
  context: string;
}> {
  if (!locator || !Number.isInteger(locator.line) || !Number.isInteger(locator.column)) {
    const error = new Error('valid source locator required') as ErrorWithStatus;
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
  const match: {
    selected: NodePath<t.JSXElement | t.JSXFragment> | null;
    owner: NodePath | null;
  } = { selected: null, owner: null };
  traverse(ast, {
    JSXElement(path) {
      if (!contains(path.node, locator.line, locator.column)) return;
      if (!match.selected || nodeLength(path.node) < nodeLength(match.selected.node)) {
        match.selected = path;
        match.owner = componentPath(path);
      }
    },
    JSXFragment(path) {
      if (!contains(path.node, locator.line, locator.column)) return;
      if (!match.selected || nodeLength(path.node) < nodeLength(match.selected.node)) {
        match.selected = path;
        match.owner = componentPath(path);
      }
    },
  });
  const { selected, owner } = match;
  if (!selected) {
    const error = new Error(
      `source element not found at ${locator.file}:${locator.line}:${locator.column}`,
    ) as ErrorWithStatus;
    error.status = 404;
    throw error;
  }

  const imports = ast.program.body
    .filter((node) => node.type === 'ImportDeclaration')
    .map((node) => source.slice(node.start ?? 0, node.end ?? 0))
    .join('\n');
  const selectedNode = selected.node;
  const selectedSource = source.slice(selectedNode.start ?? 0, selectedNode.end ?? 0);
  const ownerSource = owner
    ? source.slice(owner.node.start ?? 0, owner.node.end ?? 0)
    : selectedSource;
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

function nodeLength(node: t.Node): number {
  return (node.end ?? 0) - (node.start ?? 0);
}

export async function assertNoEscapingSymlinks(projectDir: string): Promise<void> {
  const realProject = await fs.realpath(projectDir);
  const visit = async (directory: string): Promise<void> => {
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
