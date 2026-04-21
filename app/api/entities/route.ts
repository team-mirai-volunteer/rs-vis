import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import type { RS2024StructuredData, EntityType } from '@/types/structured';

// サーバーキャッシュ（プロセス起動中は再読み込み不要）
let cachedEntities: EntityListItem[] | null = null;

export interface CorporateNumberInfo {
  name: string;       // NTA登録名称
  address: string;    // 都道府県＋市区町村
  isMatch: boolean;   // 当該エンティティ名と一致するか
}

export interface EntityListItem {
  spendingName: string;
  displayName: string;          // displayName があれば、なければ spendingName
  entityType: EntityType | null;
  parentName: string | null;
  totalSpendingAmount: number;
  projectCount: number;
  corporateNumbers: string[];   // 法人番号の配列（複数の場合はデータ品質の証跡）
  // 法人番号 → NTA情報マップ（null = NTAデータベース未登録）
  corporateNumberInfo: Record<string, CorporateNumberInfo | null>;
}

export interface EntitiesResponse {
  entities: EntityListItem[];
  summary: {
    total: number;                  // 表記上のユニーク件数（spendingName 単位）
    normalizedCount: number;        // 正規化後のユニーク件数（displayName 単位）
    totalAmount: number;
    byEntityType: Record<string, { count: number; totalAmount: number }>;
  };
}

interface HoujinLookupEntry {
  name: string;
  typeCode: string;
  typeLabel: string;
  address: string;
}

function loadHoujinLookup(): Record<string, HoujinLookupEntry> {
  const lookupPath = path.join(process.cwd(), 'public/data/houjin-lookup.json');
  if (!fs.existsSync(lookupPath)) return {};
  return JSON.parse(fs.readFileSync(lookupPath, 'utf-8')) as Record<string, HoujinLookupEntry>;
}

function loadEntities(): EntityListItem[] {
  if (cachedEntities) return cachedEntities;

  const dataPath = path.join(process.cwd(), 'public/data/rs2024-structured.json');
  if (!fs.existsSync(dataPath)) {
    throw new Error('rs2024-structured.json が見つかりません');
  }

  const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8')) as RS2024StructuredData;
  const houjinLookup = loadHoujinLookup();

  // spendingName でグループ化して1エントリに集約
  const grouped = new Map<string, EntityListItem>();

  for (const s of data.spendings) {
    const cn = (s.corporateNumber ?? '').trim();
    const existing = grouped.get(s.spendingName);

    if (!existing) {
      grouped.set(s.spendingName, {
        spendingName: s.spendingName,
        displayName: s.displayName ?? s.spendingName,
        entityType: s.entityType ?? null,
        parentName: s.parentName ?? null,
        totalSpendingAmount: s.totalSpendingAmount,
        projectCount: s.projectCount,
        corporateNumbers: cn ? [cn] : [],
        corporateNumberInfo: {},
      });
    } else {
      existing.totalSpendingAmount += s.totalSpendingAmount;
      existing.projectCount += s.projectCount;
      if (cn && !existing.corporateNumbers.includes(cn)) {
        existing.corporateNumbers.push(cn);
      }
    }
  }

  // 法人番号ごとにNTA情報を付与
  for (const entity of grouped.values()) {
    for (const cn of entity.corporateNumbers) {
      const ntaEntry = houjinLookup[cn] ?? null;
      entity.corporateNumberInfo[cn] = ntaEntry
        ? {
            name: ntaEntry.name,
            address: ntaEntry.address,
            // NTA登録名称がエンティティ名（spendingName or displayName）と一致するか
            isMatch:
              ntaEntry.name === entity.spendingName ||
              ntaEntry.name === entity.displayName,
          }
        : null;
    }
  }

  cachedEntities = Array.from(grouped.values());
  return cachedEntities;
}

export async function GET() {
  try {
    const entities = loadEntities();

    // entityType 別の集計
    const byEntityType: Record<string, { count: number; totalAmount: number }> = {};
    let totalAmount = 0;
    const displayNameSet = new Set<string>();

    for (const e of entities) {
      const key = e.entityType ?? 'その他';
      if (!byEntityType[key]) byEntityType[key] = { count: 0, totalAmount: 0 };
      byEntityType[key].count++;
      byEntityType[key].totalAmount += e.totalSpendingAmount;
      totalAmount += e.totalSpendingAmount;
      displayNameSet.add(e.displayName);
    }

    const response: EntitiesResponse = {
      entities,
      summary: {
        total: entities.length,
        normalizedCount: displayNameSet.size,
        totalAmount,
        byEntityType,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error loading entities:', error);
    return NextResponse.json({ error: 'Failed to load entities' }, { status: 500 });
  }
}
