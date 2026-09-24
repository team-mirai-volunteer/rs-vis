import baseV1 from './fiscal-share-base-v1.json';
import type { FiscalForm } from './fiscal-space-form';
import { decodeScenarioDetailed, encodeScenario, FISCAL_MODEL_VERSION } from './fiscal-space-url';

// This snapshot is part of the wire format. Never regenerate v1 when defaults change.
// A stored model version still passes through the normal migration and validation.
type Change = [string[], unknown] | [string[]]; // Missing value means deletion; null remains a value.
const PREFIX = '#scenario=s1.';
const LIMIT = 50_000;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const unsafe = (key: string) => ['__proto__', 'prototype', 'constructor'].includes(key);

function changes(base: unknown, value: unknown, path: string[] = []): Change[] {
  if (Object.is(base, value)) return [];
  if (object(base) && object(value)) return [...new Set([...Object.keys(base), ...Object.keys(value)])].flatMap(key =>
    Object.hasOwn(value, key) ? changes(base[key], value[key], [...path, key]) : [[ [...path, key] ] as Change]);
  if (JSON.stringify(base) === JSON.stringify(value)) return [];
  return [[path, value]];
}

function applyChanges(value: unknown) {
  if (!Array.isArray(value) || value.length > 2000) throw new Error('Invalid shared changes');
  const form = structuredClone(baseV1) as Record<string, unknown>;
  for (const change of value) {
    if (!Array.isArray(change) || change.length < 1 || change.length > 2 || !Array.isArray(change[0])) throw new Error('Invalid shared change');
    const path = change[0];
    if (path.length < 1 || path.length > 20 || path.some(k => typeof k !== 'string' || unsafe(k))) throw new Error('Invalid shared path');
    let parent = form;
    for (const key of path.slice(0, -1)) {
      if (!Object.hasOwn(parent, key) || !object(parent[key])) throw new Error('Invalid shared parent');
      parent = parent[key] as Record<string, unknown>;
    }
    if (change.length === 1) delete parent[path.at(-1)!];
    else parent[path.at(-1)!] = change[1];
  }
  return form;
}

async function readBounded(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > LIMIT) { await reader.cancel(); throw new Error('Shared data too large'); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}

/** Keep all settings, but transmit only changes from a frozen baseline, compressed locally. */
export async function encodeSharedScenario(form: FiscalForm): Promise<string> {
  const canonical = JSON.parse(decodeURIComponent(encodeScenario(form).slice(10))).form;
  const json = JSON.stringify([FISCAL_MODEL_VERSION, changes(baseV1, canonical)]);
  const bytes = await readBounded(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip')));
  return PREFIX + btoa(Array.from(bytes, b => String.fromCharCode(b)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function decodeSharedScenario(hash: string): Promise<ReturnType<typeof decodeScenarioDetailed>> {
  if (!hash.startsWith(PREFIX)) return decodeScenarioDetailed(hash);
  if (hash.length > LIMIT) throw new Error('Shared URL too long');
  const encoded = hash.slice(PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length % 4 === 1) throw new Error('Invalid shared encoding');
  const bytes = Uint8Array.from(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const unpacked = await readBounded(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')));
  const payload: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(unpacked));
  if (!Array.isArray(payload) || payload.length !== 2 || typeof payload[0] !== 'string') throw new Error('Invalid shared payload');
  return decodeScenarioDetailed('#scenario=' + encodeURIComponent(JSON.stringify({ version: payload[0], form: applyChanges(payload[1]) })));
}
