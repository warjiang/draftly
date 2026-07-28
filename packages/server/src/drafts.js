/**
 * drafts.js — HTML 草稿存储与版本管理（M1）
 * 存储布局：<rootDir>/<draftId>/v1.html, v2.html, ... + meta.json
 * meta.json: { id, title, prompt, createdAt, versions: [{ v, kind, instruction, at }] }
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export class DraftNotFoundError extends Error {
  constructor(id) {
    super(`draft not found: ${id}`);
    this.status = 404;
  }
}

export class DraftStore {
  /** @param {{ rootDir: string }} opts */
  constructor({ rootDir }) {
    this.rootDir = rootDir;
  }

  _dir(id) { return path.join(this.rootDir, id); }
  _metaPath(id) { return path.join(this._dir(id), 'meta.json'); }

  /** 草稿列表（按创建时间倒序） */
  async list() {
    let names;
    try { names = await fs.readdir(this.rootDir); } catch { return []; }
    const drafts = [];
    for (const name of names) {
      try {
        drafts.push(JSON.parse(await fs.readFile(this._metaPath(name), 'utf8')));
      } catch { /* 非草稿目录 / 损坏 meta，跳过 */ }
    }
    return drafts.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  /** 创建空草稿（尚无版本） */
  async create({ prompt }) {
    const id = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    const meta = {
      id,
      title: String(prompt || '未命名草稿').replace(/\s+/g, ' ').trim().slice(0, 30) || '未命名草稿',
      prompt,
      createdAt: new Date().toISOString(),
      versions: [],
    };
    await fs.mkdir(this._dir(id), { recursive: true });
    await fs.writeFile(this._metaPath(id), JSON.stringify(meta, null, 2));
    return meta;
  }

  /** 追加一个版本，返回 { meta, v } */
  async saveVersion(id, html, { kind = 'generate', instruction = null } = {}) {
    const meta = await this.meta(id);
    const v = meta.versions.length + 1;
    await fs.writeFile(path.join(this._dir(id), `v${v}.html`), html);
    meta.versions.push({ v, kind, instruction, at: new Date().toISOString() });
    await fs.writeFile(this._metaPath(id), JSON.stringify(meta, null, 2));
    return { meta, v };
  }

  async meta(id) {
    try {
      return JSON.parse(await fs.readFile(this._metaPath(id), 'utf8'));
    } catch {
      throw new DraftNotFoundError(id);
    }
  }

  /** 读取某版本 HTML；v 缺省 = 最新版本 */
  async readHtml(id, v = null) {
    const meta = await this.meta(id);
    const version = v ?? meta.versions.length;
    if (!Number.isInteger(version) || version < 1 || version > meta.versions.length) {
      throw new DraftNotFoundError(`${id} v${version}`);
    }
    const html = await fs.readFile(path.join(this._dir(id), `v${version}.html`), 'utf8');
    return { meta, html, version };
  }
}
