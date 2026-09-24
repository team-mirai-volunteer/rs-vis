import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import data from '../app/lib/tax-expenditures/data.json';
import { PAGES } from '../components/navigation/pages';

test('application total agrees with MOF, excluding consolidated-group subsets', () => {
  const total = data.measures.reduce((total, m) => total + m.rows.filter(r => r.entity === '単体法人')
    .reduce((sum, r) => sum + (r.years['2024'][0] ?? 0), 0), 0);
  assert.equal(total, 2513286);
  assert.equal(data.amountUnit, '千円');
  const donation = data.measures.find(m => m.rsProjectId === 127)!;
  assert.equal(donation.article, '42の12の2');
  assert.equal(donation.rows[0].years['2024'][2], 2899075);
  assert.equal(donation.rows[1].years['2024'][2], 492584); // subset, not an additional credit
  assert.equal(donation.rows[2].years['2024'][2], null); // missing is not zero
});

test('source rows are unique and all registered RS relations resolve to the stated institution', () => {
  const rows = data.measures.flatMap(m => m.rows.map(r => r.sourceRow));
  assert.equal(new Set(rows).size, rows.length);
  assert.equal(data.measures.length, 79);
  const projects = JSON.parse(readFileSync('public/data/rs2025-project-details.json', 'utf8'));
  for (const m of data.measures.filter(m => m.rsProjectId)) {
    assert.match(projects[String(m.rsProjectId)].purpose, /企業版ふるさと納税/);
    assert.match(projects[String(m.rsProjectId)].projectName, /普及促進/);
  }
  assert.equal(PAGES[PAGES.findIndex(p => p.href === '/subcontracts') + 1].href, '/tax-expenditures');
});
