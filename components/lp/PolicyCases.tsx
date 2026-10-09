import Link from 'next/link';
import { ArrowUpRight, ChevronDown } from 'lucide-react';
import { SUPPORT_CASE, INVESTIGATION_CASE } from '@/app/lp/policy-cases';

const linkClass = 'inline-flex items-center gap-1 text-sm font-bold text-primary-accent underline underline-offset-2 hover:opacity-90';

export function PolicyCases() {
  return (
    <section id="policy-cases" aria-labelledby="policy-cases-heading" className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <p className="text-sm font-bold text-primary-accent">From data to policy</p>
        <h2 id="policy-cases-heading" className="mt-1 text-2xl/8 font-bold tracking-normal">数字の先に、政策の選択肢をつくる</h2>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-mirai-text-subtle">増やすべき予算や、支援の届き方を変える方法も探せます。以下は調査のモデルケース。確認済みの記載と、これから求める根拠を分けています。</p>
        <div className="mt-6 grid items-start gap-4 lg:grid-cols-2">
          <article id="support-case" aria-labelledby="support-case-heading" className="rounded-2xl border border-mirai-border bg-card p-5 sm:p-6">
            <p className="text-xs font-bold text-primary-accent">モデルケース 1 · 支援を届ける</p>
            <h3 id="support-case-heading" className="mt-1 text-lg/7 font-bold">{SUPPORT_CASE.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-mirai-text-subtle">{SUPPORT_CASE.intro}</p>
            <dl className="mt-4 space-y-3 text-sm leading-relaxed">
              <div className="rounded-xl bg-mirai-surface-teal p-3">
                <dt className="text-xs font-bold text-primary-accent">いま画面で分かること</dt>
                <dd className="mt-1">{SUPPORT_CASE.visible}</dd>
              </div>
              <div className="rounded-xl bg-mirai-surface p-3">
                <dt className="text-xs font-bold text-mirai-text">追加で確かめること</dt>
                <dd className="mt-1 text-mirai-text-subtle">{SUPPORT_CASE.unknown}</dd>
              </div>
            </dl>
            <Link href={SUPPORT_CASE.project.href} className={`${linkClass} mt-4`}>学校施設整備の事業詳細を開く <ArrowUpRight className="size-4 shrink-0" aria-hidden="true" /></Link>
            <details className="group mt-5 border-t border-mirai-border pt-4">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-bold [&::-webkit-details-marker]:hidden">
                3つの原因と、国会で確かめる問い
                <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <ol className="mt-4 space-y-4">
                {SUPPORT_CASE.diagnoses.map((item, index) => (
                  <li key={item.title}>
                    <h4 className="text-sm font-bold">{index + 1}. {item.title}</h4>
                    <p className="mt-1 text-sm leading-relaxed text-mirai-text-subtle">{item.evidence}</p>
                    <p className="mt-1 text-sm leading-relaxed">{item.option}</p>
                  </li>
                ))}
              </ol>
              <div className="mt-4 rounded-xl border-l-4 border-primary bg-mirai-surface-teal/60 p-3">
                <h4 className="text-xs font-bold text-primary-accent">国会で確かめる問い（試案）</h4>
                <p className="mt-1 text-sm leading-relaxed">{SUPPORT_CASE.question}</p>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-mirai-text-subtle"><span className="font-bold text-primary-accent">改善後の確認：</span>{SUPPORT_CASE.followUp}</p>
            </details>
          </article>
          <article id="investigation-case" aria-labelledby="investigation-case-heading" className="rounded-2xl border border-mirai-border bg-card p-5 sm:p-6">
            <p className="text-xs font-bold text-primary-accent">モデルケース 2 · 1件を最後まで調べる</p>
            <h3 id="investigation-case-heading" className="mt-1 text-lg/7 font-bold">{INVESTIGATION_CASE.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-mirai-text-subtle">{INVESTIGATION_CASE.intro}</p>
            <ol className="mt-4 space-y-3">
              {INVESTIGATION_CASE.steps.map((step, index) => (
                <li key={step.title} className="flex gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-mirai-surface-teal text-xs font-bold text-primary-accent" aria-hidden="true">{index + 1}</span>
                  <div>
                    <h4 className="text-sm font-bold">{step.title}</h4>
                    <p className="mt-1 text-sm leading-relaxed text-mirai-text-subtle">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-4 flex flex-col items-start gap-2">
              <Link href={INVESTIGATION_CASE.vendor.href} className={linkClass}>事業者の年度別の記載を開く <ArrowUpRight className="size-4 shrink-0" aria-hidden="true" /></Link>
              <Link href={INVESTIGATION_CASE.project.href} className={linkClass}>ハローワークの事業詳細を開く <ArrowUpRight className="size-4 shrink-0" aria-hidden="true" /></Link>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
