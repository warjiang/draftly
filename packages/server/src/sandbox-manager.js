/**
 * sandbox-manager.js — 单 sandbox 生命周期管理（Phase 1 单项目；Phase 4 可扩多项目）。
 */
import { ProjectSandbox } from './sandbox.js';
import { FileHistory } from './history.js';

export class SandboxManager {
  /** @param {{ rootDir: string }} opts */
  constructor({ rootDir }) {
    this._sandbox = new ProjectSandbox({ rootDir });
    this._history = null;
    this._created = false;
  }

  /** 已创建（create() 过）的 sandbox */
  async ensureCreated() {
    if (!this._created) {
      await this._sandbox.create();
      this._created = true;
    }
    return this._sandbox;
  }

  /** 同步拿 sandbox（假定已 ensureCreated；API 层先调 ensureCreated） */
  sandbox() { return this._sandbox; }

  history() {
    if (!this._history) this._history = new FileHistory(this._sandbox);
    return this._history;
  }

  /** 确保 preview 已启动，返回 { port, url } */
  async ensureStarted() {
    await this.ensureCreated();
    if (this._sandbox.isRunning()) return { port: this._sandbox.port, url: this._sandbox.url };
    return this._sandbox.start();
  }
}
