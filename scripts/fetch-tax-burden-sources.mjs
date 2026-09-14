/**
 * Download the public source files for the tax-burden statistics (R3 household survey, R8 OECD Taxing Wages).
 * Files land in data/raw/tax-burden/ (git-ignored). Re-run to refresh; then `npm run generate-tax-burden-stats`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve('data/raw/tax-burden');
mkdirSync(OUT, { recursive: true });

const SOURCES = [
  {
    file: 'kakei-2024-table3-quintile-decile.xlsx',
    // 家計調査 家計収支編 2024年 第3表 年間収入五分位・十分位階級別（総世帯・勤労者世帯） stat_infid=000040246659
    url: 'https://www.e-stat.go.jp/stat-search/file-download?statInfId=000040246659&fileKind=0',
  },
  {
    file: 'oecd-taxing-wages-jpn-2024-2025.csv',
    url: 'https://sdmx.oecd.org/public/rest/data/OECD.CTP.TPS,DSD_TAX_WAGES_COU@DF_TW_COU,2.1/JPN.......?startPeriod=2024&dimensionAtObservation=AllDimensions&format=csvfilewithlabels',
  },
  {
    file: 'oecd-taxing-wages-npatr-all-2023-2025.csv',
    url: 'https://sdmx.oecd.org/public/rest/data/OECD.CTP.TPS,DSD_TAX_WAGES_COU@DF_TW_COU,2.1/.NPATR.....A?startPeriod=2023&dimensionAtObservation=AllDimensions&format=csvfile',
  },
];

for (const { file, url } of SOURCES) {
  const response = await fetch(url, { headers: { Accept: file.endsWith('.csv') ? 'text/csv' : '*/*' } });
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  writeFileSync(resolve(OUT, file), bytes);
  console.log(`saved ${file} (${bytes.length} bytes) retrieved ${new Date().toISOString().slice(0, 10)}`);
}
