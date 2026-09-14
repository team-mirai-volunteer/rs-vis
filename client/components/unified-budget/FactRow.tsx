'use client';

/** サイドパネルの「項目名 / 値」1 行（dl の dt/dd） */
export function FactRow({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-mirai-text-muted">{k}</dt>
      <dd className="break-all">{v}</dd>
    </>
  );
}
