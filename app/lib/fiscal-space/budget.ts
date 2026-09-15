/** Comparison anchor only; do not insert the central-government budget into SNA general government. */
export const CURRENT_BUDGET = {
  amount: 1_254_228 * 1e8,
  label: '2026年度・国の一般会計（補正後）',
  sourceUrl: 'https://www.mof.go.jp/policy/budget/budger_workflow/budget/fy2026/hosei260603d.pdf',
  enactedAt: '2026-06-05', checkedAt: '2026-09-15',
  // 財務省「令和8年度補正後予算フレーム」の億円表示を円へ換算。
  expenditure: [
    { label: '一般歳出', amount: 732_692 * 1e8, note: '社会保障、文教・科学技術、公共事業、防衛など' },
    { label: '地方交付税交付金等', amount: 208_778 * 1e8, note: '地方公共団体の財源となる交付金など' },
    { label: '国債費', amount: 312_758 * 1e8, note: '債務の償還・利払いなど' },
  ],
  revenue: [
    { label: '税収', amount: 837_350 * 1e8, note: '租税・印紙収入。社会保険料は含まない' },
    { label: 'その他収入', amount: 89_902 * 1e8, note: '税収・公債金以外の収入' },
    { label: '公債金', amount: 326_975 * 1e8, note: '国債の発行で賄う額' },
  ],
  debtService: { redemption: 178_898 * 1e8, interest: 130_371 * 1e8 },
};
