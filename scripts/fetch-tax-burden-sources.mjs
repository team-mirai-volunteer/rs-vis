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
    file: 'kakei-2024-table3-2-age.xlsx',
    // 家計調査 家計収支編 2024年 第3-2表 世帯主の年齢階級別（二人以上の世帯・勤労者世帯・無職世帯） stat_infid=000040247076
    url: 'https://www.e-stat.go.jp/stat-search/file-download?statInfId=000040247076&fileKind=0',
  },
  {
    file: 'oecd-taxing-wages-jpn-2024-2025.csv',
    url: 'https://sdmx.oecd.org/public/rest/data/OECD.CTP.TPS,DSD_TAX_WAGES_COU@DF_TW_COU,2.1/JPN.......?startPeriod=2024&dimensionAtObservation=AllDimensions&format=csvfilewithlabels',
  },
  {
    // Continuous 50-250% of average wage (1% steps), four household types (couples = one earner): Japan, all measures
    file: 'oecd-taxing-wages-decomp-jpn-2024-2025.csv',
    url: 'https://sdmx.oecd.org/public/rest/data/OECD.CTP.TPS,DSD_TAX_WAGES_DECOMP@DF_TW_DECOMP,2.1/JPN......?startPeriod=2024&dimensionAtObservation=AllDimensions&format=csvfile',
  },
  {
    // Continuous net personal average tax rate for all OECD members plus the OECD_REP aggregate
    file: 'oecd-taxing-wages-decomp-npatr-all-2024-2025.csv',
    url: 'https://sdmx.oecd.org/public/rest/data/OECD.CTP.TPS,DSD_TAX_WAGES_DECOMP@DF_TW_DECOMP,2.1/.NPATR.....?startPeriod=2024&dimensionAtObservation=AllDimensions&format=csvfile',
  },
  {
    // Revenue Statistics for Japan: category 1200 is corporate income tax, national and local combined
    file: 'oecd-revenue-jpn.csv',
    url: 'https://sdmx.oecd.org/public/rest/data/OECD.CTP.TPS,DSD_REV_OECD@DF_REVJPN,2.0/all?startPeriod=2022&format=csvfile',
  },
  {
    // National accounts, income approach: D11 wages and salaries, D1 compensation of employees (denominators for tax incidence)
    file: 'oecd-sna-jpn-income.csv',
    url: 'https://sdmx.oecd.org/public/rest/data/OECD.SDD.NAD,DSD_NAMAIN10@DF_TABLE1_INCOME,2.0/A.JPN...........?startPeriod=2022&format=csvfile',
  },
  {
    // Revenue Statistics comparative table: category 1200 for every OECD member, national currency (XDC values are in billions)
    file: 'oecd-revenue-comparative.csv',
    url: 'https://sdmx.oecd.org/public/rest/data/OECD.CTP.TPS,DSD_REV_COMP_OECD@DF_RSOECD,1.0/all?startPeriod=2020&format=csvfile',
  },
  {
    // National accounts D11 wages and salaries for every country (denominator of the cross-country incidence ratio)
    file: 'oecd-sna-income-all.csv',
    url: 'https://sdmx.oecd.org/public/rest/data/OECD.SDD.NAD,DSD_NAMAIN10@DF_TABLE1_INCOME,2.0/A....D11....XDC.V...?startPeriod=2020&format=csvfile',
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
