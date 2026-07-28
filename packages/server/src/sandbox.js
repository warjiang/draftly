/**
 * sandbox.js — ProjectSandbox（SPEC 2.2）
 * 管理一个隔离项目目录 + 其预览服务的完整生命周期。
 *
 * dev server 选择策略（SPEC 实现注）：
 *  1. rootDir/node_modules/.bin/vite 存在 → spawn 真实 vite（生产路径）
 *  2. 否则 → 内置 preview-server（离线降级路径，本阶段默认）
 * 对外接口不变。
 */
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createPreviewServer } from './preview-server.js';

const DEFAULT_APP = `export default function App() {
  return (
    <div style={{ padding: '40px', maxWidth: '720px', margin: '0 auto' }}>
      <h1>draftly</h1>
      <p>沙箱已就绪。通过编辑器或 /api/generate 生成页面。</p>
    </div>
  );
}
`;

export class ProjectSandbox {
  /**
   * @param {{ rootDir: string, templateDir?: string }} opts
   */
  constructor({ rootDir, templateDir } = {}) {
    if (!rootDir) throw new Error('ProjectSandbox: rootDir is required');
    this.rootDir = path.resolve(rootDir);
    this.templateDir = templateDir || null;
    this.port = null;
    this.url = null;
    this._server = null;   // 内置 preview-server 实例
    this._child = null;    // vite 子进程（若可用）
  }

  /** 生成项目骨架（不跑 npm install；若提供 templateDir 则拷贝模板） */
  async create() {
    await fs.mkdir(path.join(this.rootDir, 'src'), { recursive: true });
    if (this.templateDir) {
      await fs.cp(this.templateDir, this.rootDir, { recursive: true });
      return;
    }
    const writeIfAbsent = async (rel, content) => {
      const abs = path.join(this.rootDir, rel);
      if (!fss.existsSync(abs)) {
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, content, 'utf8');
      }
    };
    await writeIfAbsent('package.json', JSON.stringify({
      name: path.basename(this.rootDir), private: true, version: '0.0.0', type: 'module',
    }, null, 2));
    await writeIfAbsent('index.html', '<!-- preview-server 动态生成外壳；此文件供未来 vite 路径使用 -->\n');
    await writeIfAbsent('src/App.jsx', DEFAULT_APP);
  }

  async writeFile(relPath, content) {
    const abs = this._resolve(relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf8');
  }

  async readFile(relPath) {
    return fs.readFile(this._resolve(relPath), 'utf8');
  }

  /** 递归列出项目文件（相对路径，POSIX 风格，排除 node_modules/.git） */
  async listFiles() {
    const out = [];
    const walk = async (dir) => {
      let entries;
      try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name === 'node_modules' || e.name === '.git') continue;
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) await walk(abs);
        else out.push(path.relative(this.rootDir, abs).split(path.sep).join('/'));
      }
    };
    await walk(this.rootDir);
    return out.sort();
  }

  /** 启动预览服务，端口自动分配（listen(0)） */
  async start() {
    if (this.isRunning()) return { port: this.port, url: this.url };
    const viteBin = path.join(this.rootDir, 'node_modules', '.bin', 'vite');
    if (fss.existsSync(viteBin)) {
      try {
        return await this._startVite(viteBin);
      } catch { /* 落到内置路径 */ }
    }
    this._server = createPreviewServer({ rootDir: this.rootDir });
    await new Promise((resolve, reject) => {
      this._server.once('error', reject);
      this._server.listen(0, '127.0.0.1', resolve);
    });
    this.port = this._server.address().port;
    this.url = `http://127.0.0.1:${this.port}/`;
    return { port: this.port, url: this.url };
  }

  /** vite 路径：解析 stdout 中的端口；失败回退内置 preview-server */
  async _startVite(viteBin) {
    const port = await getFreePort();
    const child = spawn(process.execPath, [viteBin, '--port', String(port), '--strictPort'], {
      cwd: this.rootDir, stdio: ['ignore', 'pipe', 'pipe'],
    });
    this._child = child;
    await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('vite start timeout')), 8000);
      const onData = (buf) => {
        if (/Local:|ready in/i.test(String(buf))) { clearTimeout(to); resolve(); }
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.once('exit', () => { clearTimeout(to); reject(new Error('vite exited')); });
      child.once('error', (e) => { clearTimeout(to); reject(e); });
    }).catch(async (e) => {
      this._child = null;
      try { child.kill('SIGTERM'); } catch { /* noop */ }
      throw e;
    });
    this.port = port;
    this.url = `http://127.0.0.1:${port}/`;
    return { port, url: this.url };
  }

  async stop() {
    if (this._child) {
      const child = this._child;
      this._child = null;
      await new Promise((resolve) => {
        const to = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* noop */ } resolve(); }, 2000);
        child.once('exit', () => { clearTimeout(to); resolve(); });
        try { child.kill('SIGTERM'); } catch { resolve(); }
      });
    }
    if (this._server) {
      const srv = this._server;
      this._server = null;
      await new Promise((resolve) => {
        srv.close(() => resolve());
        // closeAllConnections 立即中断 keep-alive 连接（如 SSE），确保 close 回调触发
        srv.closeAllConnections?.();
      });
    }
    this.port = null;
    this.url = null;
  }

  async restart() {
    await this.stop();
    return this.start();
  }

  isRunning() {
    return Boolean(this._server?.listening || (this._child && !this._child.killed));
  }

  _resolve(relPath) {
    const abs = path.resolve(this.rootDir, relPath);
    if (!abs.startsWith(this.rootDir + path.sep) && abs !== this.rootDir) {
      throw new Error(`path escapes sandbox root: ${relPath}`);
    }
    return abs;
  }
}

async function getFreePort() {
  const { createServer } = await import('node:http');
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}
