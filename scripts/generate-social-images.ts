import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { SHARE_PAGES, socialImagePath } from '../app/lib/page-metadata';

const escape = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
async function main() {
  await mkdir('public/og', { recursive: true });
  const logo = await readFile('public/logos/team-mirai-wordmark.svg', 'utf8');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
    for (const item of SHARE_PAGES.filter(item => !process.argv[2] || item.href === process.argv[2])) {
      await page.setContent(`<html lang="ja"><style>
        *{box-sizing:border-box}body{margin:0;background:#f5f8f6;color:#123b35;font-family:'Yu Gothic',Meiryo,sans-serif}
        main{position:relative;width:1200px;height:630px;padding:60px 68px;overflow:hidden;border-top:12px solid #2aa693}
        header{display:flex;align-items:center;gap:28px;font-size:22px;font-weight:bold}header svg{width:190px;height:36px}
        h1{position:relative;max-width:1030px;font-size:58px;line-height:1.4;margin:56px 0 20px;letter-spacing:-1px}
        p{position:relative;max-width:1000px;font-size:26px;line-height:1.7;margin:0}footer{position:absolute;bottom:42px;font-size:20px;color:#376c60}
        .art{position:absolute;right:-150px;bottom:-260px;width:600px;height:600px;border:90px solid #d7eee6;border-radius:50%;z-index:0}
      </style><main><div class="art"></div><header>${logo}<span>行政事業レビュー可視化</span></header><h1>${escape(item.label)}</h1><p>${escape(item.description)}</p><footer>予算を知る。支出をたどる。政策を考える。</footer></main></html>`);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `public${socialImagePath(item.href)}` });
    }
  } finally { await browser.close(); }
}
void main();
