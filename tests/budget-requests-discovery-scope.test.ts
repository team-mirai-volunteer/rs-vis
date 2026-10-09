import test from 'node:test';
import assert from 'node:assert/strict';
import {
  discoverChildren, discoverExcludedChildUrls, extractOfficialLinks,
  isCurrentRequestDocument, isCurrentRequestSource, sourceDocument,
} from '../scripts/budget-requests-discover';

const NOW = '2026-10-09T19:00:00Z';
const parent = (url = 'https://www.maff.go.jp/j/budget/index.html') =>
  sourceDocument(url, '農林水産省 一般会計', '農林水産省', 2027, NOW, null, '一般会計', 'accounting_table');
const urls = (html: string) => discoverChildren(html, parent(), NOW).map(doc => doc.url);

test('undated subsections retain the nearest parent fiscal year, not the page year', () => {
  const html = '<h1>令和9年度概算要求</h1><h2>令和8年度の補助事業等</h2><h3>公共事業</h3><a href="old.pdf">農業農村整備事業</a><h3>非公共事業</h3><a href="old2.pdf">分割版</a><h2>令和9年度概算要求</h2><h3>公共事業</h3><a href="current.pdf">農業農村整備事業</a>';
  assert.deepEqual(urls(html), ['https://www.maff.go.jp/j/budget/current.pdf']);
  assert.deepEqual(extractOfficialLinks(html, parent().url)[0].headingPath, ['令和9年度概算要求', '令和8年度の補助事業等', '公共事業']);
});

test('nested old-year catalogue sections cannot admit hundreds of generic PDFs', () => {
  const sections = [9, 8, 7, 6, 2].map(year => `<h3>令和${year}年度予算</h3><h4>非公共事業</h4>${Array.from({ length: 25 }, (_, i) => `<a href="section-${year}-${i}.pdf">分割版(${i})</a>`).join('')}`).join('');
  const docs = discoverChildren(`<h1>農村振興局予算</h1>${sections}`, parent(), NOW);
  assert.equal(docs.length, 25);
  assert.ok(docs.every(doc => doc.url.includes('/section-9-')));
});

test('current anchors and row years outrank a publication-year section label', () => {
  // CAA publishes FY2027 requests below a heading that still says FY2026.
  const html = '<h1>予算</h1><h2>令和8年度</h2><a href="current.pdf">令和9年度概算要求書</a><a href="old.pdf">令和8年度概算要求書</a><table><tr><td>令和9年度要求書</td><td><a href="row.pdf">PDF</a></td></tr></table>';
  assert.deepEqual(urls(html), ['https://www.maff.go.jp/j/budget/current.pdf', 'https://www.maff.go.jp/j/budget/row.pdf']);
});

test('standalone year list labels scope fisheries links until the next year or heading', () => {
  const html = '<h1>水産予算・決算の概要</h1><h2>予算</h2><ul><li>令和９年度</li></ul><a href="current.pdf">水産関係予算概算要求の概要</a><ul><li>令和8年度</li></ul><a href="old.pdf">水産関係予算概算要求の概要</a><h2>その他</h2><a href="undated.pdf">予算資料</a>';
  assert.deepEqual(urls(html), ['https://www.maff.go.jp/j/budget/current.pdf']);
});

test('neutral departmental portals remain traversable without admitting undated files', () => {
  const html = '<h1>予算</h1><h3>平成25年度</h3><a href="old.pdf">概算要求書</a><h4>各局庁予算のページ</h4><a href="/j/nousin/soumu/yosan/index.html">農村振興局</a><a href="undated.pdf">予算資料</a><a href="placeholder.html"></a>';
  assert.deepEqual(urls(html), ['https://www.maff.go.jp/j/nousin/soumu/yosan/index.html']);
});

test('known fiscal filename conventions reject old MAFF PDFs even under a current label', () => {
  for (const path of ['pdf/r8yokyu_gaiyo.pdf', 'r08yokyusho.html', 'h31hojo/attach/pdf/index-1.pdf', 'pdf/r08_toushi.pdf', 'fy2026_overview.pdf']) {
    assert.equal(isCurrentRequestSource(`https://www.maff.go.jp/j/budget/${path}`, 2027), false, path);
    assert.deepEqual(urls(`<h1>令和9年度</h1><a href="${path}">令和9年度概算要求書</a>`), [], path);
  }
  assert.equal(isCurrentRequestSource('https://www.maff.go.jp/j/budget/pdf/tougou1-20_r9yokyu.pdf', 2027), true);
});

test('CMS era directories and publication-year filenames do not override current content', () => {
  for (const url of [
    'https://www.mext.go.jp/a_menu/yosan/r01/1420672_00003.html',
    'https://www.env.go.jp/guide/budget/r06/page_00018.html',
    'https://www.digital.go.jp/assets/20260904_policies_budget_r8request_table_01.pdf',
    'https://www.maff.go.jp/20260901/current.pdf',
  ]) assert.equal(isCurrentRequestSource(url, 2027), true, url);
});

test('ancestor request context preserves integrated current PDFs under generic subheadings', () => {
  const html = '<h1>令和9年度農林水産予算概算要求</h1><h2>主要項目</h2><h3><a href="pdf/tougou1-20_r9yokyu.pdf">統合版（1～20）</a></h3><h2>参考資料</h2><a href="pdf/r9yokyu_zaito.pdf">財政投融資計画表</a>';
  const doc = { ...parent(), documentType: 'index' as const };
  assert.equal(discoverChildren(html, doc, NOW).length, 2);
});

test('nested special accounts override the general-account catalogue and ignore numbering', () => {
  const html = '<h1>令和9年度概算要求書</h1><h2>1.一般会計</h2><a href="general.pdf">歳出</a><h2>2.東日本大震災復興特別会計</h2><a href="recovery.pdf">歳出</a><h2>3.特別会計</h2><h3>（1）食料安定供給</h3><a href="food.pdf">歳出</a><h3>（2）国有林野事業債務管理</h3><a href="forest.pdf">歳出</a>';
  assert.deepEqual(discoverChildren(html, parent(), NOW).map(doc => doc.account), ['一般会計', '東日本大震災復興特別会計', '特別会計', '特別会計']);
});

test('combined budget and staff overviews are retained but dedicated staff/tax files are not', () => {
  const html = '<h1>令和9年度</h1><a href="combined.pdf">令和9年度予算概算要求及び機構定員要求の概要</a><a href="staff.pdf">令和9年度機構・定員要求の概要</a><a href="tax.pdf">令和9年度税制改正要望の概要</a>';
  assert.deepEqual(urls(html), ['https://www.maff.go.jp/j/budget/combined.pdf']);
});

test('current request-linked policy supplements retain inherited request context', () => {
  const doc = { ...parent('https://www.npa.go.jp/policies/budget/R9/gaisanyokyu/seisakuhyouka.html'), title: '令和9年度概算要求書 / 政策評価調書', documentType: 'index' as const };
  assert.equal(discoverChildren('<h1>政策評価調書</h1><a href="00_taikeizu.pdf">政策評価体系図等</a>', doc, NOW).length, 1);
});

test('commented placeholders and footer links are excluded without dropping genuine nested content', () => {
  const html = '<div id="main_content"><h1>令和9年度予算</h1><div><div><a href="current.pdf">概算要求書</a></div></div><!-- <a href="[[[id=●]]]">令和9年度予算の概要</a> --></div><div class="footer"><a href="privacy.html">予算関連リンク</a></div>';
  assert.deepEqual(urls(html), ['https://www.maff.go.jp/j/budget/current.pdf']);
  const excluded = discoverExcludedChildUrls(html, parent());
  assert.ok(excluded.includes('https://www.maff.go.jp/j/budget/privacy.html'));
  assert.ok(excluded.some(url => url.includes('[[[id=')));
  assert.equal(excluded.some(url => url.endsWith('/current.pdf')), false);
  assert.equal(excluded.some(url => url.endsWith('/disappeared.pdf')), false);
});

test('a URL mentioned in both old and current sections is retained and never cleanup-excluded', () => {
  const html = '<h1>予算</h1><h2>令和8年度</h2><a href="shared.pdf">概算要求書</a><h2>令和9年度</h2><a href="shared.pdf">概算要求書</a>';
  assert.equal(urls(html).length, 1);
  assert.deepEqual(discoverExcludedChildUrls(html, parent()), []);
});

test('stored explicit old-year documents are rejected without trusting requestedFY metadata', () => {
  assert.equal(isCurrentRequestDocument({ ...parent(), title: '令和8年度概算要求' }), false);
  assert.equal(isCurrentRequestDocument({ ...parent(), title: '令和8年度 / 令和9年度概算要求' }), true);
  assert.equal(isCurrentRequestDocument(parent()), true);
});

test('bracketed paragraph year labels scope reconstruction policy-table links', () => {
  const html = '<h1>予算</h1><p>【令和９年度予算】</p><ul><li><a href="current.html">概算要求概要</a></li></ul><p>【令和８年度予算】</p><ul><li><a href="old-policy.html">政策ごとの予算との対応について</a></li></ul><p>【平成２５年度予算】</p><ul><li><a href="post_169.html">政策ごとの予算との対応について</a></li></ul>';
  assert.deepEqual(urls(html), ['https://www.maff.go.jp/j/budget/current.html']);
  assert.deepEqual(discoverExcludedChildUrls(html, parent()), ['https://www.maff.go.jp/j/budget/old-policy.html', 'https://www.maff.go.jp/j/budget/post_169.html']);
});


test('HTML navigation cannot inherit relevance from an earlier current-budget heading', () => {
  const html = '<h1>令和9年度予算概算要求</h1><h2>要求資料</h2><a href="current.html">概算要求書</a><h2>政策について</h2><a href="policy.html">政策について</a><a href="pension.html">年金</a>';
  assert.deepEqual(urls(html), ['https://www.maff.go.jp/j/budget/current.html']);
});

test('one current request news link cannot authorize its unrelated HTML siblings', () => {
  const html = '<h1>みどりの食料システム戦略</h1><ul><li><a href="meeting.html">戦略本部を開催しました</a><a href="current.html">令和9年度予算概算要求の概要</a><a href="old-release.html">環境負荷低減の実証を拡大</a></li></ul>';
  assert.deepEqual(urls(html), ['https://www.maff.go.jp/j/budget/current.html']);
});

test('budget archive headings alone do not authorize undated historical article links', () => {
  const html = '<h1>予算</h1><h2>令和9年度</h2><a href="current.html">概算要求の概要</a><h2>これまでの予算の概要</h2><a href="old.pdf">令和7年度概算要求</a><a href="2024/comment.html">令和6年8月30日 大臣発言</a>';
  assert.deepEqual(urls(html), ['https://www.maff.go.jp/j/budget/current.html']);
});

test('MHLW and SOUMU content containers exclude sidebars while retaining the page heading', () => {
  for (const id of ['contents', 'contentsWrapper']) {
    const html = `<h1>令和9年度概算要求書</h1><div id="${id}"><div><a href="current.pdf">歳出</a><a href="current.html">概算要求書</a></div></div><div id="localnavi"><a href="news.html">広報・報道</a><a href="law.html">所管法令</a></div>`;
    assert.deepEqual(urls(html), ['https://www.maff.go.jp/j/budget/current.pdf', 'https://www.maff.go.jp/j/budget/current.html']);
    assert.ok(discoverExcludedChildUrls(html, parent()).includes('https://www.maff.go.jp/j/budget/news.html'));
  }
});

test('a directly labeled policy evaluation supplement remains a current HTML target', () => {
  const html = '<h1>予算</h1><h2>令和9年度</h2><a href="assessment.html">政策評価調書</a>';
  assert.deepEqual(urls(html), ['https://www.maff.go.jp/j/budget/assessment.html']);
});


test('SOUMU sidebar inside contentsWrapper cannot inherit the final policy-table heading', () => {
  const html = '<div id="contentsWrapper"><div class="contentsBody"><h1>令和9年度概算要求書</h1><h2>令和9年度政策評価調書</h2><a href="policy.pdf">個別票</a></div><div class="contentsMenu"><a href="news.html">広報・報道</a><a href="law.html">所管法令等</a></div></div>';
  assert.deepEqual(urls(html), ['https://www.maff.go.jp/j/budget/policy.pdf']);
});
