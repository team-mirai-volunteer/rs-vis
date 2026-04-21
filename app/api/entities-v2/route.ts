import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import type { RS2024StructuredData, EntityType } from '@/types/structured';

// サーバーキャッシュ（プロセス起動中は再読み込み不要）
let cachedEntitiesV2: EntityListItemV2[] | null = null;

export interface CorporateNumberInfo {
  name: string;
  address: string;
  isMatch: boolean;
}

export interface EntityListItemV2 {
  spendingName: string;
  displayName: string;
  entityType: EntityType | null;
  parentName: string | null;
  totalSpendingAmount: number;
  projectCount: number;
  corporateNumbers: string[];
  corporateNumberInfo: Record<string, CorporateNumberInfo | null>;
  l1: string | null;
  l2: string | null;
}

export interface EntitiesV2Response {
  entities: EntityListItemV2[];
  summary: {
    total: number;
    normalizedCount: number;
    totalAmount: number;
    byEntityType: Record<string, { count: number; totalAmount: number }>;
    byL1: Record<string, { count: number; totalAmount: number }>;
    labeledCount: number;
    labeledAmount: number;
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

function loadEntityLabels(): Record<string, { l1: string; l2: string }> {
  const labelsPath = path.join(process.cwd(), 'public/data/entity-labels.json');
  if (!fs.existsSync(labelsPath)) return {};
  return JSON.parse(fs.readFileSync(labelsPath, 'utf-8')) as Record<string, { l1: string; l2: string }>;
}

function loadEntitiesV2(): EntityListItemV2[] {
  if (cachedEntitiesV2) return cachedEntitiesV2;

  const dataPath = path.join(process.cwd(), 'public/data/rs2024-structured.json');
  if (!fs.existsSync(dataPath)) {
    throw new Error('rs2024-structured.json が見つかりません');
  }

  const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8')) as RS2024StructuredData;
  const houjinLookup = loadHoujinLookup();
  const entityLabels = loadEntityLabels();

  const grouped = new Map<string, EntityListItemV2>();

  for (const s of data.spendings) {
    const cn = (s.corporateNumber ?? '').trim();
    const existing = grouped.get(s.spendingName);
    const labelInfo = entityLabels[s.spendingName] ?? null;

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
        l1: labelInfo?.l1 ?? null,
        l2: labelInfo?.l2 ?? null,
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
            isMatch:
              ntaEntry.name === entity.spendingName ||
              ntaEntry.name === entity.displayName,
          }
        : null;
    }
  }

  cachedEntitiesV2 = Array.from(grouped.values());
  return cachedEntitiesV2;
}

export async function GET() {
  try {
    const entities = loadEntitiesV2();

    const byEntityType: Record<string, { count: number; totalAmount: number }> = {};
    const byL1: Record<string, { count: number; totalAmount: number }> = {};
    let totalAmount = 0;
    let labeledCount = 0;
    let labeledAmount = 0;
    const displayNameSet = new Set<string>();

    for (const e of entities) {
      const etKey = e.entityType ?? 'その他';
      if (!byEntityType[etKey]) byEntityType[etKey] = { count: 0, totalAmount: 0 };
      byEntityType[etKey].count++;
      byEntityType[etKey].totalAmount += e.totalSpendingAmount;

      const l1Key = e.l1 ?? 'ラベルなし';
      if (!byL1[l1Key]) byL1[l1Key] = { count: 0, totalAmount: 0 };
      byL1[l1Key].count++;
      byL1[l1Key].totalAmount += e.totalSpendingAmount;

      totalAmount += e.totalSpendingAmount;
      if (e.l1) {
        labeledCount++;
        labeledAmount += e.totalSpendingAmount;
      }
      displayNameSet.add(e.displayName);
    }

    const response: EntitiesV2Response = {
      entities,
      summary: {
        total: entities.length,
        normalizedCount: displayNameSet.size,
        totalAmount,
        byEntityType,
        byL1,
        labeledCount,
        labeledAmount,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error loading entities v2:', error);
    return NextResponse.json({ error: 'Failed to load entities' }, { status: 500 });
  }
}
