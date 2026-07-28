/**
 * build.js — 无构建 SPA 的「构建」：拷贝 public/ → dist/（保持 npm run build 契约）。
 * 若未来引入 Vite，此脚本替换为 vite build 即可。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'public');
const dest = path.join(root, 'dist');
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
console.log(`editor build: ${src} -> ${dest} (${fs.readdirSync(dest).length} files)`);
