'use client';

import { fiscalNavigationUrl } from '@/app/lib/rs-fiscal-year';
import Link from 'next/link';
import { createContext, useCallback, useContext, useId, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { Landmark, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PageNavMenu } from './PageNavMenu';
import { PAGES, PRIMARY_PAGES, PRODUCT_NAME, type NavPageHref } from './pages';
import dynamic from 'next/dynamic';

/**
 * AI ナビは開いたときだけ読み込む。ルートレイアウトに置いたことで、エージェント・ツール実行層・基金／事業者の
 * ライブラリが全ページの初期バンドルに乗っていたため（開かない人には不要な数百 KB）。SSR も不要
 */
const AiAssistant = dynamic(() => import('@/client/components/ai/AiAssistant').then(m => m.AiAssistant), { ssr: false });
import { AiResultProvider } from '@/client/lib/ai/result-handler';

/** AI ナビが条件を解釈するのに使う RS シート年度の既定（最新の実績年度 2024 のシート） */
const DEFAULT_AI_SHEET_YEAR = 2025;

type HeaderConfig = { fiscalYear?: number; owner: string; position: 'static' | 'fixed'; hasControls: boolean; className?: string };
const DEFAULT_CONFIG: HeaderConfig = { owner: '', position: 'static', hasControls: false };
const HeaderContext = createContext<{
  slot: HTMLDivElement | null;
  configure: Dispatch<SetStateAction<HeaderConfig>>;
} | null>(null);

/** Keep navigation mounted while pages provide their own controls through a portal. */
export function AppHeaderProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const current = PAGES.find(page => pathname === page.href || pathname.startsWith(`${page.href}/`))?.href ?? '/';
  const [config, configure] = useState(DEFAULT_CONFIG);
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const context = useMemo(() => ({ slot, configure }), [slot]);
  // AI ナビ（全ページ共通）。ここに 1 つだけ置くので、ページを移動しても会話は消えない
  const [aiOpen, setAiOpen] = useState(false);
  const closeAi = useCallback(() => setAiOpen(false), []);
  const pageLabel = PAGES.find(page => page.href === current)?.navLabel ?? 'トップ';
  // 年度を持つページはその実績年度のシート（実績年度 + 1）、持たないページは最新
  const aiSheetYear = config.fiscalYear !== undefined ? config.fiscalYear + 1 : DEFAULT_AI_SHEET_YEAR;

  return <HeaderContext.Provider value={context}>
    <AiResultProvider>
      <HeaderFrame current={current} config={config} slotRef={setSlot} aiOpen={aiOpen} onToggleAi={() => setAiOpen(v => !v)} />
      <AiAssistant open={aiOpen} onClose={closeAi} sheetYear={aiSheetYear} page={pageLabel} />
      {children}
    </AiResultProvider>
  </HeaderContext.Provider>;
}

/**
 * 全ページ共通の浮島ヘッダー（チームみらいデザインシステム §7「固定ヘッダー」）。
 * 白い rounded-2xl のカードが warm gray の地に浮く。左にワードマークと製品名、
 * 中央（xl 以上）に主要ナビ、右に各ページ固有のコントロール（年度セレクト等）と全件メニュー。
 *
 * 高さは globals.css の `--app-header-h`（72px = 上下 12px + 島 48px。下の 12px がサイドパネルやキャンバスとの隙間）。
 * 640px 未満（sm 未満）では右スロットを島の 2 段目に落として横スクロールさせる（島 48px + 46px → 変数は 118px）。
 * - `position="static"`（既定）: 縦 flex のページで最初の子として置く
 * - `position="fixed"`: 全画面キャンバス型ページで使う。キャンバス側は
 *   `top: var(--app-header-h)` から始める（`fixed inset-x-0 bottom-0 top-[var(--app-header-h)]`）
 */
export function AppHeader({
  children,
  position = 'static',
  fiscalYear,
  className,
}: {
  current: NavPageHref | '/';
  fiscalYear?: number;
  /** 右側スロット。YearSelect・ViewSelect・「データについて」など、ページ固有のコントロール */
  children?: ReactNode;
  position?: 'static' | 'fixed';
  className?: string;
}) {
  const context = useContext(HeaderContext);
  const owner = useId();
  const hasControls = Boolean(children);
  const configure = context?.configure;
  useLayoutEffect(() => {
    if (!configure) return;
    configure({ owner, position, hasControls, className, fiscalYear });
    return () => configure(previous => previous.owner === owner ? DEFAULT_CONFIG : previous);
  }, [configure, owner, position, hasControls, className, fiscalYear]);

  return <>
    {position === 'static' && <div aria-hidden="true" className={cn('h-[72px] shrink-0', hasControls && 'max-sm:h-[118px]')} />}
    {context?.slot && createPortal(children, context.slot)}
  </>;
}

/** 主要ナビのホバーカードの幅（px） */
const HINT_WIDTH = 280;

function HeaderFrame({ current, config, slotRef, aiOpen, onToggleAi }: {
  current: NavPageHref | '/';
  config: HeaderConfig;
  slotRef: (element: HTMLDivElement | null) => void;
  aiOpen: boolean;
  onToggleAi: () => void;
}) {
  // 主要ナビは右スロットの幅しだいで入り切らなくなる。文字の途中で切れないよう、
  // 収まらない項目は丸ごと隠す（全件は右端のメニューから辿れる）。768px 以上なら幅に応じて出せる分だけ出す（以前は 1280px 未満で全部隠していた）
  const navRef = useRef<HTMLElement>(null);
  const [fitCount, setFitCount] = useState<number>(PRIMARY_PAGES.length);
  // 主要ナビの項目にホバー・フォーカスしたとき、正式名と説明を小さなカードで出す。
  // ナビは overflow-hidden で測っているので、カードは fixed で項目の下に置く（画面右端は内側に寄せる）
  const [hint, setHint] = useState<{ index: number; left: number; top: number } | null>(null);
  const hintId = useId();
  const showHint = (index: number, element: HTMLElement) => {
    const r = element.getBoundingClientRect();
    setHint({ index, left: Math.max(8, Math.min(r.left, window.innerWidth - HINT_WIDTH - 8)), top: r.bottom + 6 });
  };
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const measure = () => {
      const links = Array.from(nav.children) as HTMLElement[];
      const overflow = links.findIndex(link => link.offsetLeft + link.offsetWidth > nav.clientWidth + 0.5);
      setFitCount(overflow === -1 ? links.length : overflow);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    // Web フォント（Noto Sans JP）の読み込み後は文字幅が変わるが、ナビ自体の幅は変わらず observer が発火しないので測り直す
    let active = true;
    void document.fonts?.ready.then(() => { if (active) measure(); });
    return () => {
      active = false;
      observer.disconnect();
    };
  }, []);

  return (
    <header
      data-pan-disabled="true"
      className={cn(
        'pointer-events-none inset-x-0 top-0 z-40 px-3 py-3',
        config.position === 'fixed' ? 'fixed' : 'absolute',
        config.className
      )}
    >
      <div className="pointer-events-auto flex flex-wrap items-center gap-x-3 rounded-2xl border border-mirai-border bg-card px-4 shadow-xs sm:h-12 sm:flex-nowrap">
        {/* ブランドマーク。チームみらいのワードマークはいったん外し、丸地のアイコン＋製品名にする */}
        <Link href="/" className="flex h-12 shrink-0 items-center gap-2 transition-opacity hover:opacity-80" aria-label={`${PRODUCT_NAME} トップ`}>
          <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-full bg-mirai-gradient text-mirai-text">
            <Landmark className="size-4" strokeWidth={2.25} />
          </span>
          <span className="text-[15px] font-bold tracking-normal text-mirai-text">{PRODUCT_NAME}</span>
        </Link>

        <nav ref={navRef} aria-label="主要ビュー" className="relative ml-2 hidden min-w-0 items-center gap-0.5 overflow-hidden md:flex">
          {PRIMARY_PAGES.map((item, index) => {
            const isCurrent = item.href === current;
            const fits = index < fitCount;
            return (
              <Link
                key={item.href}
                href={fiscalNavigationUrl(item.href, config.fiscalYear)}
                aria-current={isCurrent ? 'page' : undefined}
                aria-hidden={fits ? undefined : true}
                tabIndex={fits ? undefined : -1}
                aria-describedby={hint?.index === index ? hintId : undefined}
                onMouseEnter={e => showHint(index, e.currentTarget)}
                onMouseLeave={() => setHint(null)}
                onFocus={e => showHint(index, e.currentTarget)}
                onBlur={() => setHint(null)}
                className={cn(
                  'shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-xs transition-colors',
                  !fits && 'invisible',
                  isCurrent
                    ? 'bg-mirai-surface-teal font-bold text-primary-accent'
                    : 'font-medium text-mirai-text-subtle hover:bg-mirai-surface hover:text-mirai-text'
                )}
              >
                {item.navLabel}
              </Link>
            );
          })}
        </nav>
        {hint && (
          <div
            id={hintId}
            role="tooltip"
            className="pointer-events-none fixed z-[60] rounded-xl border border-mirai-border bg-card px-3 py-2 text-xs leading-relaxed shadow-soft"
            style={{ left: hint.left, top: hint.top, width: HINT_WIDTH }}
          >
            <p className="font-bold text-mirai-text">{PRIMARY_PAGES[hint.index].label}</p>
            <p className="mt-0.5 text-mirai-text-subtle">{PRIMARY_PAGES[hint.index].description}</p>
          </div>
        )}

        {/* 右スロット。sm 未満では basis-full で 2 段目に落ち、横にスクロールする（スクロールバーは隠す） */}
        <div ref={slotRef} className={cn('order-last h-[46px] basis-full items-center gap-2 overflow-x-auto pb-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:order-none sm:ml-auto sm:h-12 sm:basis-auto sm:overflow-visible sm:pb-0', config.hasControls ? 'flex' : 'hidden')} />
        {/* 右スロットがあれば sm 以上ではそちらが ml-auto を持つ（両方に持たせると余白が二分され中央に寄る）。
            右スロットが無いページ（トップなど）は自身で右端へ寄せる */}
        <div className={cn('ml-auto flex h-12 shrink-0 items-center gap-1.5', config.hasControls && 'sm:ml-0')}>
          {/* AI ナビ。全件メニューの左に、同じ体裁の丸ボタンで置く */}
          <Button
            variant="outline"
            size="sm"
            onClick={onToggleAi}
            aria-label="AIに聞く"
            aria-pressed={aiOpen}
            title="AIに聞く（公開データから事業を探す）"
            data-testid="ai-assistant-open"
            className={cn('gap-1 border-mirai-border px-2.5 text-xs font-bold', aiOpen ? 'bg-mirai-surface-teal text-primary-accent' : 'text-mirai-text-subtle')}
          >
            <Sparkles className="size-4" />AI
          </Button>
          <PageNavMenu current={current} fiscalYear={config.fiscalYear} />
        </div>
      </div>
    </header>
  );
}
