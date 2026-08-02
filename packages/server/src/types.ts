import type { ChildProcessWithoutNullStreams } from 'node:child_process';

export type ErrorWithStatus = Error & {
  status?: number;
  code?: string | number;
  stdout?: string;
  stderr?: string;
};

export type CommandResult = {
  stdout: string;
  stderr: string;
};

export type CommandOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string | null;
  onStdout?: (text: string) => void;
  onStderr?: (text: string) => void;
};

export type CommandRunner = (
  command: string,
  args: string[],
  options?: CommandOptions,
) => Promise<CommandResult>;

export type PiPublicEvent = {
  type: string;
  role?: string;
  toolName?: string;
  toolCallId?: string;
  toolSummary?: string;
  isError?: boolean;
  assistantMessageEvent?: {
    type: string;
    deltaLength: number;
  };
};

export type PiTaskOptions = {
  cwd: string;
  instruction: string;
  images?: string[];
  systemPrompt?: string;
  onEvent?: (event: PiPublicEvent) => void;
};

export interface WorkspaceProvider {
  runTask(options: PiTaskOptions): Promise<string>;
}

export type PipelineEvent = {
  type: 'pipeline';
  stage: string;
  variant?: number;
  total?: number;
  version?: number;
  target?: number;
  file?: string;
  line?: number;
  component?: string | null;
};

export type ProgressEvent =
  | PipelineEvent
  | {
      type: 'pi';
      variant?: number;
      event: PiPublicEvent;
    };

export type ProgressHandler = (event: ProgressEvent) => void;

export type DraftVersion = {
  v: number;
  commit: string;
  kind: string;
  instruction: string | null;
  summary: string | null;
  files: string[];
  at: string;
};

export type DraftMeta = {
  id: string;
  projectId?: string;
  title: string;
  prompt: string;
  format: string;
  schemaVersion: number;
  templateVersion: number;
  projectDir: string;
  createdAt: string;
  versions: DraftVersion[];
  migration?: {
    status: string;
    attemptedAt?: string;
    migratedAt?: string;
    error?: string;
    sourceVersion?: number;
    legacyBackup?: string;
  };
};

export type ProjectDesignSource = 'default' | 'template' | 'import';

export type ProjectDesign = {
  source: ProjectDesignSource;
  name: string;
  templateId: string | null;
  content: string;
};

export type ProjectMeta = {
  id: string;
  title: string;
  prompt: string;
  design: ProjectDesign;
  draftIds: string[];
  activeDraftId: string | null;
  createdAt: string;
  updatedAt: string;
  role?: 'owner' | 'editor' | 'viewer';
};

export type SourceLocator = {
  file: string;
  line: number;
  column: number;
  tagName?: string;
  jsxName?: string;
  text?: string;
  component?: string;
  styles?: Record<string, string>;
  styleEdits?: Record<string, string>;
  comment?: string;
};

export type Preview = {
  url: string;
  token: string;
  status: 'ready';
};

export interface PreviewManagerLike {
  ensure(id: string): Promise<Preview>;
  shutdown(): Promise<void>;
}

export type PreviewEntry = {
  id: string;
  child: ChildProcessWithoutNullStreams;
  port: number;
  url: string;
  token: string;
  lastUsed: number;
  output: () => string;
};

export type TemplateTags = {
  style: string[];
  industry: string[];
  color: string[];
};

export type DesignTemplate = {
  id: string;
  name: string;
  sourceUrl?: string;
  tags: TemplateTags;
  confidence: string;
  screenshot?: string | null;
  designMd: string;
};

export function errorWithStatus(error: unknown): ErrorWithStatus {
  return error instanceof Error ? error as ErrorWithStatus : new Error(String(error));
}
