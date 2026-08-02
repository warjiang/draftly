import {
  buildGenerateInstruction,
  buildImageEditInstruction,
  buildIterateInstruction,
  buildSourceEditInstruction,
} from './draft-prompts.js';
import type { DraftStore } from './drafts.js';
import { assertNoEscapingSymlinks, sourceContextForLocator } from './source-locator.js';
import type {
  CommandRunner,
  ProgressHandler,
  SourceLocator,
  WorkspaceProvider,
} from './types.js';

export const MAX_VARIANTS = 3;

type DraftResult = {
  id: string;
  title: string;
  version: number;
};

type VersionTaskOptions = {
  drafts: DraftStore;
  provider?: WorkspaceProvider;
  id: string;
  kind: string;
  instruction: string;
  taskInstruction: string;
  images?: string[];
  onProgress?: ProgressHandler;
  variant?: number;
};

function workspaceExecutor(provider?: WorkspaceProvider): WorkspaceProvider {
  if (!provider?.runTask) throw new Error('Pi workspace executor is required');
  return provider;
}

async function validateProject(
  projectDir: string,
  commandRunner: CommandRunner,
  onProgress?: ProgressHandler,
): Promise<void> {
  onProgress?.({ type: 'pipeline', stage: 'validation_started' });
  await assertNoEscapingSymlinks(projectDir);
  await commandRunner('npm', ['run', 'build'], { cwd: projectDir });
  onProgress?.({ type: 'pipeline', stage: 'validation_completed' });
}

async function executeVersionTask({
  drafts,
  provider,
  id,
  kind,
  instruction,
  taskInstruction,
  images = [],
  onProgress,
  variant,
}: VersionTaskOptions) {
  const executor = workspaceExecutor(provider);
  return drafts.runVersionTransaction(
    id,
    { kind, instruction },
    async (cwd) => {
      onProgress?.({ type: 'pipeline', stage: 'agent_started', variant });
      const summary = await executor.runTask({
        cwd,
        instruction: taskInstruction,
        images,
        onEvent: (event) => onProgress?.({ type: 'pi', variant, event }),
      });
      onProgress?.({ type: 'pipeline', stage: 'agent_completed', variant });
      await validateProject(cwd, drafts.run, (event) => onProgress?.({ ...event, variant }));
      onProgress?.({ type: 'pipeline', stage: 'commit_started', variant });
      return { summary };
    },
  );
}

export async function generateDrafts({
  drafts,
  provider,
  prompt,
  variants = 1,
  designMd = null,
  projectId,
  onProgress,
}: {
  drafts: DraftStore;
  provider?: WorkspaceProvider;
  prompt: string;
  variants?: string | number;
  designMd?: string | null;
  projectId?: string;
  onProgress?: ProgressHandler;
}): Promise<{ drafts: DraftResult[] }> {
  if (!prompt?.trim()) throw new Error('prompt required');
  const count = Math.min(
    Math.max(Number.parseInt(String(variants), 10) || 1, 1),
    MAX_VARIANTS,
  );
  const settled = await Promise.allSettled(
    Array.from({ length: count }, async (_, index) => {
      const variant = index + 1;
      onProgress?.({ type: 'pipeline', stage: 'variant_started', variant, total: count });
      const draft = await drafts.createProject({
        prompt,
        designMd,
        projectId,
        onProgress: (event) => onProgress?.({ ...event, variant }),
      });
      try {
        const task = await executeVersionTask({
          drafts,
          provider,
          id: draft.id,
          kind: 'generate',
          instruction: prompt,
          taskInstruction: buildGenerateInstruction({
            userPrompt: prompt,
            designMd,
            variant,
          }),
          onProgress,
          variant,
        });
        onProgress?.({
          type: 'pipeline',
          stage: 'version_saved',
          variant,
          version: task.version,
        });
        onProgress?.({ type: 'pipeline', stage: 'variant_completed', variant });
        return {
          id: draft.id,
          title: task.meta.title,
          version: task.version,
        };
      } catch (error) {
        await drafts.remove(draft.id);
        throw error;
      }
    }),
  );
  const results = settled
    .filter((item) => item.status === 'fulfilled')
    .map((item) => item.value);
  if (!results.length) {
    const failure = settled.find(
      (item): item is PromiseRejectedResult => item.status === 'rejected',
    );
    throw failure?.reason ?? new Error('draft generation failed');
  }
  return { drafts: results };
}

export async function iterateDraft({
  drafts,
  provider,
  id,
  instruction,
  onProgress,
}: {
  drafts: DraftStore;
  provider?: WorkspaceProvider;
  id: string;
  instruction: string;
  onProgress?: ProgressHandler;
}): Promise<DraftResult> {
  if (!instruction?.trim()) throw new Error('instruction required');
  onProgress?.({ type: 'pipeline', stage: 'context_loaded' });
  const result = await executeVersionTask({
    drafts,
    provider,
    id,
    kind: 'iterate',
    instruction,
    taskInstruction: buildIterateInstruction({ instruction }),
    onProgress,
  });
  onProgress?.({ type: 'pipeline', stage: 'version_saved', version: result.version });
  return { id, title: result.meta.title, version: result.version };
}

export async function editDraftSource({
  drafts,
  provider,
  id,
  locator,
  locators,
  instruction,
  onProgress,
}: {
  drafts: DraftStore;
  provider?: WorkspaceProvider;
  id: string;
  locator?: SourceLocator;
  locators?: SourceLocator[];
  instruction: string;
  onProgress?: ProgressHandler;
}): Promise<DraftResult & {
  locator: {
    file: string;
    line: number;
    component: string | null;
  };
}> {
  const locatorList = locators?.length ? locators : locator ? [locator] : [];
  if (!locatorList.length) throw new Error('locator required');
  const hasComments = locatorList.some((loc) => loc.comment?.trim());
  if (!instruction?.trim() && !hasComments) throw new Error('instruction required');
  const contexts = await Promise.all(
    locatorList.map((loc) => sourceContextForLocator({ drafts, id, locator: loc })),
  );
  const primary = contexts[0];
  const primaryLocator = locatorList[0];
  onProgress?.({
    type: 'pipeline',
    stage: 'source_located',
    file: primary.file,
    line: primaryLocator.line,
    component: primary.component,
  });
  const combinedContext =
    contexts.length > 1
      ? contexts
          .map((ctx, index) => `Element ${index + 1} (${ctx.file}):\n${ctx.context}`)
          .join('\n\n')
      : primary.context;
  const historyInstruction = instruction?.trim()
    ? instruction
    : `标注修改 ${locatorList.length} 处元素`;
  const taskInstruction = hasComments
    ? buildSourceEditInstruction({
        instruction,
        context: combinedContext,
        annotations: locatorList.map((loc, index) => ({
          context: `${contexts[index].file}:\n${contexts[index].context}`,
          comment: loc.comment?.trim() || instruction?.trim() || '按整体目标调整该元素',
        })),
      })
    : buildSourceEditInstruction({
        instruction,
        context: combinedContext,
        count: contexts.length,
      });
  const result = await executeVersionTask({
    drafts,
    provider,
    id,
    kind: 'edit-source',
    instruction: historyInstruction,
    taskInstruction,
    onProgress,
  });
  onProgress?.({ type: 'pipeline', stage: 'version_saved', version: result.version });
  return {
    id,
    title: result.meta.title,
    version: result.version,
    locator: {
      file: primary.file,
      line: primaryLocator.line,
      component: primary.component,
    },
  };
}

export async function editDraftByImage({
  drafts,
  provider,
  id,
  image,
  instruction,
  onProgress,
}: {
  drafts: DraftStore;
  provider?: WorkspaceProvider;
  id: string;
  image: string;
  instruction: string;
  onProgress?: ProgressHandler;
}): Promise<DraftResult> {
  if (!instruction?.trim()) throw new Error('instruction required');
  if (!image) throw new Error('image required');
  onProgress?.({ type: 'pipeline', stage: 'image_prepared' });
  const result = await executeVersionTask({
    drafts,
    provider,
    id,
    kind: 'edit-by-image',
    instruction,
    taskInstruction: buildImageEditInstruction({ instruction }),
    images: [image],
    onProgress,
  });
  onProgress?.({ type: 'pipeline', stage: 'version_saved', version: result.version });
  return { id, title: result.meta.title, version: result.version };
}
