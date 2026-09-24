/** 委託構造のブロック番号に揃える。AI評価・金額・他の集計値は変更しない。 */
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import type { SubcontractIndex } from '../types/subcontract';

for (const year of [2024, 2025]) {
  const read = (name: string) => JSON.parse(gunzipSync(readFileSync(`public/data/${name}.json.gz`)).toString());
  const graphs = read(`subcontracts-${year}`) as SubcontractIndex;
  const scores = read(`project-quality-scores-${year}`) as Array<{ pid: string; blockCount: number }>;
  let changed = 0;
  for (const item of scores) {
    const graph = graphs[item.pid];
    if (!graph) continue;
    const count = new Set(graph.blocks.map(block => block.blockId)).size;
    if (item.blockCount !== count) { item.blockCount = count; changed++; }
  }
  const json = JSON.stringify(scores);
  writeFileSync(`public/data/project-quality-scores-${year}.json`, json);
  writeFileSync(`public/data/project-quality-scores-${year}.json.gz`, gzipSync(json, { level: 9 }));
  console.log(`${year}: ${changed}件のブロック数を更新`);
}
