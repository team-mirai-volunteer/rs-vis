/**
 * 統合ビュー（/budget-sankey）へのディープリンク。
 *
 * かつて /sankey-svg が担っていた「事業を選んで開く」「名前で絞り込んで開く」導線を統合ビューへ向ける。
 * /sankey-svg の year は RS シート年度（2025 = 2024年度執行）だが、統合ビューの year は予算年度なので
 * シート年度 − 1 に写す（執行・支出先の列が出るのは執行年度だけ）。
 * URL パラメータの語彙は app/budget-sankey/page.tsx の parse/serialize と揃えること。
 */

/** RS シート年度 → 統合ビューの予算年度（執行年度） */
export const sheetYearToBudgetYear = (sheetYear: number | string): number => Number(sheetYear) - 1;

/** 統合ビューの「RSのみ」プリセットの列（所管 → 事業 → 事業(支出) → 支出先） */
export const UNIFIED_RS_COLS = 'mi,pr,ps,re';

function base(sheetYear: number | string): URLSearchParams {
  return new URLSearchParams({ year: String(sheetYearToBudgetYear(sheetYear)), cols: UNIFIED_RS_COLS, fnrs: '0' });
}

/** 旧 /sankey-svg 相当（RS の府省庁 → 事業 → 事業(支出) → 支出先。基準「府省庁」） */
function rsMinistryBase(sheetYear: number | string): URLSearchParams {
  const p = base(sheetYear);
  p.set('b', 'ministry');
  return p;
}

/** 事業を選択し、関連ノードだけを表示した状態で開く（旧 sankeySvgProjectUrl 相当） */
export function unifiedProjectUrl(projectId: number | string, sheetYear: number | string): string {
  const p = base(sheetYear);
  p.set('sel', `project-budget-${projectId}`);
  p.set('fr', '1');
  return `/budget-sankey?${p.toString()}`;
}

/** 事業名で絞り込んだ状態で開く（旧 /sankey-svg?fnp= 相当） */
export function unifiedProjectNameFilterUrl(projectName: string, sheetYear: number | string): string {
  const p = base(sheetYear);
  p.set('fpq', projectName);
  p.set('ffp', '1');
  return `/budget-sankey?${p.toString()}`;
}

/** 支出先名で絞り込んだ状態で開く（旧 /sankey-svg?fnr= 相当） */
export function unifiedRecipientNameFilterUrl(recipientName: string, sheetYear: number | string): string {
  const p = base(sheetYear);
  p.set('frq', recipientName);
  p.set('ffp', '1');
  return `/budget-sankey?${p.toString()}`;
}

/** 旧 /sankey-svg のノード ID → 統合ビューのノード ID。対応が無いもの（総計・集約）は null */
export function sankeySvgNodeIdToUnified(id: string): string | null {
  if (id.startsWith('project-spending-')) return id.replace('project-spending-', 'project-budget-');
  if (id.startsWith('project-budget-') || id.startsWith('r-')) return id;
  // 旧サンキー図の省庁は RS の府省庁名。統合ビューの MOF 所管（min-）とは体系が違うので、府省庁基準の RS府省庁ノードへ
  if (id.startsWith('ministry-')) return `min-rs-${id.slice('ministry-'.length)}`;
  return null;
}

/**
 * 旧 /sankey-svg のクエリ文字列を統合ビューのクエリへ写す（/sankey-svg のリダイレクトが使う）。
 * 表示範囲・選択・絞り込み・関連表示を引き継ぐ。ズーム・ラベル表示・検索語など統合ビューに
 * 対応が無いものは捨てる。
 */
export function sankeySvgSearchToUnified(search: string | URLSearchParams): string {
  const p = typeof search === 'string' ? new URLSearchParams(search) : search;
  const yr = p.get('yr');
  const sheetYear = yr === '2024' || yr === '2025' ? yr : '2025';
  // 旧サンキー図は RS の府省庁で紐づけていたので、基準「府省庁」で開く（省庁の選択・fm の絞り込みがそのまま写る）
  const out = rsMinistryBase(sheetYear);

  // 選択（sel）。無ければピン（pp: 事業, pr: 支出先, pm: 省庁名）から補う
  const sel = p.get('sel');
  let selected = sel ? sankeySvgNodeIdToUnified(sel) : null;
  if (!selected) {
    const pp = p.get('pp');
    const pr = p.get('pr');
    const pm = p.get('pm');
    if (pp) selected = sankeySvgNodeIdToUnified(pp);
    else if (pr) selected = sankeySvgNodeIdToUnified(pr);
    else if (pm) selected = `min-rs-${pm}`;
  }
  if (selected) out.set('sel', selected);

  // 表示範囲: 省庁 tm → 所管, 事業 tp → 事業・事業(支出), 支出先 tr → 支出先。開始位置 po / ro
  const copyNum = (from: string, to: string[], min = 0) => {
    const v = p.get(from);
    if (v === null) return;
    const n = Number(v);
    if (!Number.isFinite(n) || n < min) return;
    for (const key of to) out.set(key, String(Math.floor(n)));
  };
  copyNum('tm', ['tmi'], 1);
  copyNum('tp', ['tpr', 'tps'], 1);
  copyNum('tr', ['tre'], 1);
  copyNum('po', ['opr', 'ops']);
  copyNum('ro', ['ore']);

  if (p.get('fr') === '1') out.set('fr', '1');
  if (p.get('fp') === '1') out.set('ffp', '1');

  // 絞り込み。fm（RS の府省庁名）は所管の絞り込み fmi へ（府省庁基準の所管ノードは RS の府省庁名なので一致する）
  for (const fm of p.getAll('fm')) if (fm.trim()) out.append('fmi', fm.trim());
  const ac = p.get('ac');
  if (ac !== null) {
    if (ac.includes('g')) out.append('fac', 'general');
    if (ac.includes('s')) out.append('fac', 'special');
  }
  const copyText = (from: string, to: string) => {
    const v = p.get(from);
    if (v !== null && v.trim()) out.set(to, v.trim());
  };
  copyText('fnp', 'fpq');
  if (p.get('fnpr') === '1') out.set('fpr', '1');
  copyText('fnr', 'frq');
  if (p.get('fnrr') === '1') out.set('frr', '1');
  if (p.get('fnrs') === '1') out.set('frs', '1');
  copyText('fmb', 'fbmin');
  copyText('fxb', 'fbmax');
  copyText('fms', 'fsmin');
  copyText('fxs', 'fsmax');
  copyText('fso', 'fso');
  copyText('fsx', 'fsx');
  copyText('fsn', 'fsn');
  const fsd = Number(p.get('fsd'));
  if (Number.isFinite(fsd) && fsd >= 2) {
    out.set('fsub', 'has');
    out.set('fsd', String(Math.floor(fsd)));
  } else if (p.get('fsr') === '1') {
    out.set('fsub', 'has');
  }
  return out.toString();
}
