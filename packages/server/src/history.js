/**
 * history.js — 服务端文件快照历史栈（Undo/Redo）。
 * 每次 writeFile/patch 前快照旧内容入 undo 栈；undo 写回旧内容并压入 redo 栈。
 * 新写操作清空 redo 栈（标准语义）。
 */
export class FileHistory {
  /** @param {import('./sandbox.js').ProjectSandbox} sandbox */
  constructor(sandbox) {
    this.sandbox = sandbox;
    this.undoStack = []; // { rel, before: string|null, after: string }
    this.redoStack = [];
  }

  async _readSafe(rel) {
    try { return await this.sandbox.readFile(rel); } catch { return null; }
  }

  /** 写入并记录历史 */
  async write(rel, content) {
    const before = await this._readSafe(rel);
    await this.sandbox.writeFile(rel, content);
    this.undoStack.push({ rel, before, after: content });
    this.redoStack.length = 0;
  }

  /** 读-改-写并记录历史（patch 场景） */
  async mutate(rel, fn) {
    const before = await this._readSafe(rel);
    if (before === null) throw new Error(`file not found: ${rel}`);
    const after = fn(before);
    if (after === before) return after; // 无变化不入栈
    await this.sandbox.writeFile(rel, after);
    this.undoStack.push({ rel, before, after });
    this.redoStack.length = 0;
    return after;
  }

  /** @returns {Promise<{ file: string } | null>} 撤销的文件；无可撤销 → null */
  async undo() {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    if (entry.before === null) {
      // 文件是新建的 → 撤销 = 删除（写空不可行，直接删）
      const { rm } = await import('node:fs/promises');
      const path = await import('node:path');
      await rm(path.join(this.sandbox.rootDir, entry.rel), { force: true });
    } else {
      await this.sandbox.writeFile(entry.rel, entry.before);
    }
    this.redoStack.push(entry);
    return { file: entry.rel };
  }

  async redo() {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    await this.sandbox.writeFile(entry.rel, entry.after);
    this.undoStack.push(entry);
    return { file: entry.rel };
  }

  /** 外部已完成的写入补记历史（如 generatePage 直接写文件的场景） */
  pushEntry(rel, before, after) {
    this.undoStack.push({ rel, before, after });
    this.redoStack.length = 0;
  }

  /** 读取当前内容（供外部写入前取快照） */
  async current(rel) { return this._readSafe(rel); }

  status() {
    return {
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      undoDepth: this.undoStack.length,
      redoDepth: this.redoStack.length,
    };
  }
}
