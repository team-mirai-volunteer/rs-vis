'use client';

import { useCallback, useEffect, useState } from 'react';
import { type QualityYear } from '@/app/lib/api/quality-year';

import { fiscalYear, sheetYearFromParams } from '@/app/lib/rs-fiscal-year';

type QualityLocation = { year: QualityYear; mode: 'project' | 'section'; detailPid: string | null };
const INITIAL: QualityLocation = { year: '2025', mode: 'project', detailPid: null };

function readLocation(): QualityLocation {
  const params = new URLSearchParams(window.location.search);
  return {
    year: sheetYearFromParams(params, 'year', true) as QualityYear,
    mode: params.get('mode') === 'section' ? 'section' : 'project',
    detailPid: params.get('detail') || null,
  };
}

/** Keep detail selection in browser history; legacy ?pid= remains a list filter. */
export function useQualityLocation() {
  const [location, setLocation] = useState<QualityLocation>(INITIAL);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const read = () => setLocation(readLocation());
    read();
    setReady(true);
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, []);

  const navigate = useCallback((change: Partial<QualityLocation>) => {
    const next = { ...readLocation(), ...change };
    const url = new URL(window.location.href);
    // 旧共有URLはそのまま読める。新規リンクは実績年度を明示する。
    if (url.searchParams.has('year') && !url.searchParams.has('fiscalYear')) url.searchParams.set('year', next.year);
    else { url.searchParams.delete('year'); url.searchParams.set('fiscalYear', String(fiscalYear(next.year))); }
    if (next.mode === 'section') url.searchParams.set('mode', next.mode);
    else url.searchParams.delete('mode');
    if (next.detailPid) url.searchParams.set('detail', next.detailPid);
    else url.searchParams.delete('detail');
    if (url.href !== window.location.href) window.history.pushState(null, '', url);
    setLocation(next);
  }, []);

  const setYear = useCallback((year: QualityYear) => navigate({ year, detailPid: null }), [navigate]);
  const setMode = useCallback((mode: QualityLocation['mode']) => navigate({ mode, detailPid: null }), [navigate]);
  const openDetail = useCallback((detailPid: string) => navigate({ detailPid }), [navigate]);
  const closeDetail = useCallback(() => navigate({ detailPid: null }), [navigate]);
  return { ...location, ready, setYear, setMode, openDetail, closeDetail };
}
