import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import type { RS2024StructuredData } from '@/types/structured';

export interface GlobeMinistry {
  name: string;
  totalSpending: number;
  areaFraction: number;
  seed: [number, number]; // [lon, lat] in degrees — Fibonacci lattice position
  projectCount: number;
  color: string;
}

export interface GlobeResponse {
  totalSpending: number;
  ministries: GlobeMinistry[];
}

let cachedResponse: GlobeResponse | null = null;

/**
 * Fibonacci格子で球面キャップ内にN点を準均等配置する（パンゲア配置）
 * capFraction: 0-1, キャップが占める球面の割合
 * centerLon/centerLat: キャップの中心 (degrees)
 * Returns [lon, lat][] in degrees (GeoJSON convention)
 */
function fibonacciCap(
  n: number,
  capFraction: number,
  centerLon: number,
  centerLat: number,
): [number, number][] {
  const goldenRatio = (1 + Math.sqrt(5)) / 2;
  // Spherical cap: A = 2π(1 - cos θ_max), fraction = A / 4π = (1 - cos θ_max) / 2
  const cosMax = 1 - 2 * capFraction;
  const points: [number, number][] = [];

  // Generate points on north-pole cap, then rotate to center
  const cLat = centerLat * Math.PI / 180;
  const cLon = centerLon * Math.PI / 180;

  for (let i = 0; i < n; i++) {
    // Distribute within cap [0, θ_max]
    const cosTheta = 1 - (1 - cosMax) * (i + 0.5) / n;
    const theta = Math.acos(cosTheta);
    const phi = 2 * Math.PI * i / goldenRatio;

    // Point on north-pole cap (spherical coords)
    const x = Math.sin(theta) * Math.cos(phi);
    const y = Math.sin(theta) * Math.sin(phi);
    const z = Math.cos(theta);

    // Rotate: first by latitude (around Y axis equivalent), then longitude
    // Rotation from north pole (0,0,1) to (centerLat, centerLon)
    // Step 1: rotate around Y by (90° - centerLat) to tilt from pole
    const tiltAngle = Math.PI / 2 - cLat;
    const rx = x * Math.cos(tiltAngle) + z * Math.sin(tiltAngle);
    const ry = y;
    const rz = -x * Math.sin(tiltAngle) + z * Math.cos(tiltAngle);

    // Step 2: rotate around Z (world up) by centerLon
    const fx = rx * Math.cos(cLon) - ry * Math.sin(cLon);
    const fy = rx * Math.sin(cLon) + ry * Math.cos(cLon);
    const fz = rz;

    // Convert back to lat/lon
    const lat = Math.asin(Math.max(-1, Math.min(1, fz))) * 180 / Math.PI;
    let lon = Math.atan2(fy, fx) * 180 / Math.PI;
    if (lon < -180) lon += 360;
    if (lon > 180) lon -= 360;

    points.push([lon, lat]);
  }

  return points;
}

function loadGlobeData(): GlobeResponse {
  if (cachedResponse) return cachedResponse;

  const structuredPath = path.join(process.cwd(), 'public/data/rs2024-structured.json');
  const raw: RS2024StructuredData = JSON.parse(fs.readFileSync(structuredPath, 'utf8'));

  const stats = raw.statistics.byMinistry;
  const ministryNames = Object.keys(stats);

  let totalSpending = 0;
  for (const name of ministryNames) {
    totalSpending += stats[name].totalSpending;
  }

  // Sort by spending (descending)
  const sorted = ministryNames
    .map(name => ({ name, ...stats[name] }))
    .sort((a, b) => b.totalSpending - a.totalSpending);

  // Merge ministries that would get 0 icosphere faces at level 6 (81,920 faces)
  const ICO_FACES = 81920;
  const visible: typeof sorted = [];
  let otherSpending = 0;
  let otherBudget = 0;
  let otherProjectCount = 0;
  let otherRecipientCount = 0;

  for (const m of sorted) {
    const fraction = totalSpending > 0 ? m.totalSpending / totalSpending : 0;
    if (Math.round(fraction * ICO_FACES) >= 1) {
      visible.push(m);
    } else {
      otherSpending += m.totalSpending;
      otherBudget += m.totalBudget;
      otherProjectCount += m.projectCount;
      otherRecipientCount += m.recipientCount;
    }
  }

  // Add "その他" group if any ministries were merged
  if (otherSpending > 0) {
    visible.push({
      name: 'その他',
      totalSpending: otherSpending,
      totalBudget: otherBudget,
      projectCount: otherProjectCount,
      recipientCount: otherRecipientCount,
    });
  }

  // Pangaea layout: largest ministry (index 0) = "ocean", rest clustered as "continent"
  // Non-ocean ministries get seeds within a spherical cap sized to their total area
  const oceanFraction = totalSpending > 0 ? visible[0].totalSpending / totalSpending : 0;
  const continentFraction = 1 - oceanFraction;

  // Add margin to cap so continent seeds aren't too tight at the edge
  const capFraction = Math.min(0.45, continentFraction * 1.15);
  const continentCenter: [number, number] = [30, 20]; // lon, lat — arbitrary continent center

  // Generate seeds for continent ministries (index 1+)
  const continentSeeds = fibonacciCap(visible.length - 1, capFraction, continentCenter[0], continentCenter[1]);

  // Ocean seed: opposite side of sphere from continent center
  const oceanSeed: [number, number] = [
    continentCenter[0] + 180 > 180 ? continentCenter[0] - 180 : continentCenter[0] + 180,
    -continentCenter[1],
  ];

  const ministries: GlobeMinistry[] = visible.map((m, i) => ({
    name: m.name,
    totalSpending: m.totalSpending,
    areaFraction: totalSpending > 0 ? m.totalSpending / totalSpending : 1 / visible.length,
    seed: i === 0 ? oceanSeed : continentSeeds[i - 1],
    projectCount: m.projectCount,
    color: i === 0
      ? 'hsl(210, 50%, 30%)'  // Ocean: dark blue
      : `hsl(${Math.round(((i - 1) * 360) / (visible.length - 1))}, 70%, 50%)`,
  }));

  cachedResponse = { totalSpending, ministries };
  return cachedResponse;
}

export async function GET() {
  const data = loadGlobeData();
  return NextResponse.json(data);
}
