/**
 * registry.js — component-registry 加载与校验（SPEC 2.1）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REGISTRY_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'component-registry.json');

/**
 * @param {string} json component-registry.json 文本
 * @returns {{ components: Array<object> }} Registry
 */
export function loadRegistry(json) {
  const registry = JSON.parse(json);
  const errors = validateRegistry(registry);
  if (errors.length) throw new Error('invalid registry: ' + errors.join('; '));
  return registry;
}

/** 加载包内预置 registry */
export function loadBuiltinRegistry() {
  return loadRegistry(fs.readFileSync(REGISTRY_PATH, 'utf8'));
}

/**
 * @returns {string[]} 错误列表，空数组 = 通过
 */
export function validateRegistry(registry) {
  const errors = [];
  if (!registry || typeof registry !== 'object') return ['registry must be an object'];
  if (!Array.isArray(registry.components)) return ['registry.components must be an array'];
  const seen = new Set();
  registry.components.forEach((c, i) => {
    const at = `components[${i}]`;
    if (!c || typeof c !== 'object') { errors.push(`${at} must be an object`); return; }
    if (typeof c.name !== 'string' || !/^[A-Z][A-Za-z0-9]*$/.test(c.name)) {
      errors.push(`${at}.name must be a PascalCase string`);
    } else if (seen.has(c.name)) {
      errors.push(`${at}.name duplicated: ${c.name}`);
    } else seen.add(c.name);
    if (typeof c.import !== 'string' || !c.import.startsWith('@/')) {
      errors.push(`${at}.import must be an "@/..." path`);
    }
    if (c.variants !== undefined && !Array.isArray(c.variants)) {
      errors.push(`${at}.variants must be an array`);
    }
    if (c.props !== undefined && (typeof c.props !== 'object' || Array.isArray(c.props))) {
      errors.push(`${at}.props must be an object`);
    }
  });
  return errors;
}

/** 供 prompt 注入的组件索引文本（名字 + import + variants + props 摘要） */
export function componentIndex(registry) {
  return registry.components.map((c) => {
    const props = c.props && Object.keys(c.props).length
      ? ` props={${Object.entries(c.props).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join('|') : v}`).join(', ')}}`
      : '';
    const variants = c.variants?.length ? ` variants=[${c.variants.join(', ')}]` : '';
    return `- ${c.name} (from "${c.import}")${variants}${props}`;
  }).join('\n');
}

export function findComponent(registry, name) {
  return registry.components.find((c) => c.name === name) || null;
}
