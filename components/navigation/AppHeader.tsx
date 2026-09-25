'use client';

import { fiscalNavigationUrl } from '@/app/lib/rs-fiscal-year';
import Image from 'next/image';
import Link from 'next/link';
import { createContext, useContext, useId, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { PageNavMenu } from './PageNavMenu';
import { PAGES, PRIMARY_PAGES, PRODUCT_NAME, type NavPageHref } from './pages';

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

  return <HeaderContext.Provider value={context}>
    <HeaderFrame current={current} config={config} slotRef={setSlot} />
    {children}
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

function HeaderFrame({ current, config, slotRef }: {
  current: NavPageHref | '/';
  config: HeaderConfig;
  slotRef: (element: HTMLDivElement | null) => void;
}) {
  // 主要ナビは右スロットの幅しだいで入り切らなくなる。文字の途中で切れないよう、
  // 収まらない項目は丸ごと隠す（全件は右端のメニューから辿れる）
  const navRef = useRef<HTMLElement>(null);
  const [fitCount, setFitCount] = useState<number>(PRIMARY_PAGES.length);
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
        <Link href="/" className="flex h-12 shrink-0 items-center gap-3 transition-opacity hover:opacity-80" aria-label={`${PRODUCT_NAME} トップ`}>
          <Image src="/logos/team-mirai-wordmark.svg" alt="チームみらい" width={110} height={17} className="h-[17px] w-auto" priority />
          <span className="hidden border-l border-mirai-border pl-3 text-sm font-bold text-mirai-text sm:inline">{PRODUCT_NAME}</span>
        </Link>

        <nav ref={navRef} aria-label="主要ビュー" className="relative ml-2 hidden min-w-0 items-center gap-0.5 overflow-hidden xl:flex">
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

        {/* 右スロット。sm 未満では basis-full で 2 段目に落ち、横にスクロールする（スクロールバーは隠す） */}
        <div ref={slotRef} className={cn('order-last h-[46px] basis-full items-center gap-2 overflow-x-auto pb-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:order-none sm:ml-auto sm:h-12 sm:basis-auto sm:overflow-visible sm:pb-0', config.hasControls ? 'flex' : 'hidden')} />
        {/* 右スロットがあれば sm 以上ではそちらが ml-auto を持つ（両方に持たせると余白が二分され中央に寄る）。
            右スロットが無いページ（トップなど）は自身で右端へ寄せる */}
        <div className={cn('ml-auto flex h-12 shrink-0 items-center', config.hasControls && 'sm:ml-0')}>
          <PageNavMenu current={current} fiscalYear={config.fiscalYear} />
        </div>
      </div>
    </header>
  );
}
