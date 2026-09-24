import data from './data.json';

export type CreditYear = '2022' | '2023' | '2024';
// Reviewed against the source overview: these provisions contain tax credits only.
// Mixed depreciation/credit provisions need a separate row-level classification.
const definitions: Record<string, { name: string; sections?: string[] }> = {
  'mof-2024-r24': { name: '研究開発税制', sections: ['一般の試験研究費', '中小企業の試験研究費', '特別試験研究費', '税額控除の調整'] },
  'mof-2024-r76': { name: '沖縄・観光地形成促進地域' },
  'mof-2024-r82': { name: '沖縄・情報通信産業振興地域' },
  'mof-2024-r118': { name: '沖縄・特定地域（繰越税額控除）' },
  'mof-2024-r175': { name: '地方拠点の雇用促進', sections: ['雇用増加に伴う控除', '地方事業所の雇用に伴う追加控除'] },
  'mof-2024-r196': { name: '企業版ふるさと納税（法人税分）' },
  'mof-2024-r217': { name: '賃上げ促進税制', sections: ['原表(1)の給与増加に伴う控除', '原表(2)の給与増加に伴う控除', '中小企業の給与増加に伴う控除', '繰越税額控除'] },
};

export function creditSeries(year: CreditYear, ids?: Set<string>) {
  return data.measures.filter(m => definitions[m.id] && (!ids || ids.has(m.id))).map(m => {
    const definition = definitions[m.id];
    const rows = m.rows.filter(r => r.entity === '単体法人');
    const segments = rows.map((row, i) => {
      const single = row.years[year][2];
      // 2022 also has separate consolidated corporations; the middle row is
      // always a subset and must never be added to the standalone amount.
      const consolidated = year === '2022'
        ? m.rows.find(r => r.sourceRow === row.sourceRow + 2 && r.entity === '連結法人')?.years[year][2] ?? null
        : null;
      const amount = single === null && consolidated === null ? null : (single ?? 0) + (consolidated ?? 0);
      return { label: definition.sections?.[i] ?? '税額控除', section: row.section, amount, sourceRow: row.sourceRow };
    });
    return {
      id: m.id, name: definition.name, fullName: m.name, segments,
      total: segments.every(s => s.amount === null) ? null : segments.reduce((sum, s) => sum + (s.amount ?? 0), 0),
      hasMissing: segments.some(s => s.amount === null),
    };
  }).sort((a, b) => (b.total ?? -1) - (a.total ?? -1));
}

// Source amounts are in thousands of yen. 100,000 thousand yen = 1 oku yen.
export const creditAmount = (thousandYen: number) => `${(thousandYen / 100000).toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 億円`;
