#!/usr/bin/env node
/**
 * Globe面割り当て検証スクリプト（8ゾーン均等分割 + 回転軸 + 六角形配置、海は余り）
 * Usage: node scripts/globe-assignment-check.mjs > globe-assignment.csv
 */

const ICO_SUBDIVISIONS = 7;
const SPHERE_RADIUS = 1;

const API_URL = process.env.API_URL || 'http://localhost:3002/api/map/globe';
const res = await fetch(API_URL);
const data = await res.json();
const ministries = data.ministries;

function generateIcosphere(subdivisions, radius) {
  const t = (1 + Math.sqrt(5)) / 2;
  const verts = [
    -1, t, 0,  1, t, 0,  -1, -t, 0,  1, -t, 0,
    0, -1, t,  0, 1, t,  0, -1, -t,  0, 1, -t,
    t, 0, -1,  t, 0, 1,  -t, 0, -1,  -t, 0, 1,
  ];
  let faces = [
    0,11,5,  0,5,1,  0,1,7,  0,7,10,  0,10,11,
    1,5,9,  5,11,4,  11,10,2,  10,7,6,  7,1,8,
    3,9,4,  3,4,2,  3,2,6,  3,6,8,  3,8,9,
    4,9,5,  2,4,11,  6,2,10,  8,6,7,  9,8,1,
  ];
  for (let i = 0; i < verts.length; i += 3) {
    const len = Math.sqrt(verts[i]**2 + verts[i+1]**2 + verts[i+2]**2);
    verts[i] /= len; verts[i+1] /= len; verts[i+2] /= len;
  }
  for (let s = 0; s < subdivisions; s++) {
    const midCache = new Map();
    const newFaces = [];
    function getMid(a, b) {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (midCache.has(key)) return midCache.get(key);
      let mx = (verts[a*3]+verts[b*3])/2, my = (verts[a*3+1]+verts[b*3+1])/2, mz = (verts[a*3+2]+verts[b*3+2])/2;
      const len = Math.sqrt(mx*mx+my*my+mz*mz);
      mx /= len; my /= len; mz /= len;
      const idx = verts.length / 3;
      verts.push(mx, my, mz);
      midCache.set(key, idx);
      return idx;
    }
    for (let i = 0; i < faces.length; i += 3) {
      const a = faces[i], b = faces[i+1], c = faces[i+2];
      const ab = getMid(a,b), bc = getMid(b,c), ca = getMid(c,a);
      newFaces.push(a,ab,ca, b,bc,ab, c,ca,bc, ab,bc,ca);
    }
    faces = newFaces;
  }
  const vertices = new Float32Array(verts.length);
  for (let i = 0; i < verts.length; i++) vertices[i] = verts[i] * radius;
  const indices = new Uint32Array(faces);
  const faceCount = faces.length / 3;
  const adjacency = new Int32Array(faceCount * 3).fill(-1);
  const edgeToFace = new Map();
  for (let f = 0; f < faceCount; f++) {
    for (let e = 0; e < 3; e++) {
      const v0 = indices[f*3+e], v1 = indices[f*3+(e+1)%3];
      const key = v0 < v1 ? `${v0}_${v1}` : `${v1}_${v0}`;
      const other = edgeToFace.get(key);
      if (other !== undefined) {
        for (let s = 0; s < 3; s++) { if (adjacency[f*3+s]===-1) { adjacency[f*3+s]=other; break; } }
        for (let s = 0; s < 3; s++) { if (adjacency[other*3+s]===-1) { adjacency[other*3+s]=f; break; } }
      } else { edgeToFace.set(key, f); }
    }
  }
  return { vertices, indices, faceCount, adjacency };
}

function assignFaces(ico, ministries) {
  const { vertices, indices, faceCount, adjacency } = ico;
  const assignment = new Int32Array(faceCount).fill(-1);
  const centroids = new Float32Array(faceCount * 3);
  for (let f = 0; f < faceCount; f++) {
    const i0 = indices[f*3], i1 = indices[f*3+1], i2 = indices[f*3+2];
    centroids[f*3]   = (vertices[i0*3]+vertices[i1*3]+vertices[i2*3])/3;
    centroids[f*3+1] = (vertices[i0*3+1]+vertices[i1*3+1]+vertices[i2*3+1])/3;
    centroids[f*3+2] = (vertices[i0*3+2]+vertices[i1*3+2]+vertices[i2*3+2])/3;
  }

  const targetCounts = new Int32Array(ministries.length);
  let totalAssigned = 0;
  for (let m = 0; m < ministries.length; m++) {
    targetCounts[m] = m < ministries.length - 1
      ? Math.round(ministries[m].areaFraction * faceCount)
      : faceCount - totalAssigned;
    totalAssigned += targetCounts[m];
  }

  // Phase 2: 多面体シード配置 + 六角形、海は余り
  const allFaces = [];
  for (let f = 0; f < faceCount; f++) {
    allFaces.push({ f, x: centroids[f*3], y: centroids[f*3+1], z: centroids[f*3+2] });
  }

  const S3 = Math.sqrt(3);
  const oceanIdx = 0;
  const R2 = Math.SQRT1_2;

  // 再帰二分割（バッチ1用）
  function splitIntoGroups(faces, groupCount, axisIndex) {
    if (groupCount <= 1) return [faces];
    const axis = axisIndex % 3;
    if (axis === 0) faces.sort((a, b) => a.x - b.x);
    else if (axis === 1) faces.sort((a, b) => a.y - b.y);
    else faces.sort((a, b) => a.z - b.z);
    const leftCount = Math.floor(groupCount / 2);
    const rightCount = groupCount - leftCount;
    const splitIdx = Math.round(faces.length * leftCount / groupCount);
    const left = splitIntoGroups(faces.slice(0, splitIdx), leftCount, axisIndex + 1);
    const right = splitIntoGroups(faces.slice(splitIdx), rightCount, axisIndex + 1);
    return [...left, ...right];
  }

  // Voronoiグルーピング（バッチ2+用）
  function groupByNearestSeed(faces, seeds) {
    const groups = seeds.map(() => []);
    for (const face of faces) {
      let minDist = Infinity, minIdx = 0;
      for (let s = 0; s < seeds.length; s++) {
        const dx = face.x - seeds[s][0], dy = face.y - seeds[s][1], dz = face.z - seeds[s][2];
        const dist = dx*dx + dy*dy + dz*dz;
        if (dist < minDist) { minDist = dist; minIdx = s; }
      }
      groups[minIdx].push(face);
    }
    return groups;
  }

  // シード定義
  const octahedronSeeds = [
    [1,0,0], [-1,0,0], [0,1,0], [0,-1,0], [0,0,1], [0,0,-1],
  ];
  const cuboctahedronSeeds = [
    [R2,R2,0], [R2,-R2,0], [-R2,R2,0], [-R2,-R2,0],
    [R2,0,R2], [R2,0,-R2], [-R2,0,R2], [-R2,0,-R2],
    [0,R2,R2], [0,R2,-R2], [0,-R2,R2], [0,-R2,-R2],
  ];

  const batchDefs = [
    { size: 8,  mode: 'split' },
    { size: 6,  mode: 'seed', seeds: octahedronSeeds },
    { size: 12, mode: 'seed', seeds: cuboctahedronSeeds },
    { size: 6,  mode: 'coastline' },
  ];

  const nonOceanMinistries = Array.from({length: ministries.length}, (_, i) => i)
    .filter(i => i !== oceanIdx)
    .sort((a, b) => targetCounts[b] - targetCounts[a]);

  let ministryOffset = 0;
  for (let batchIdx = 0; batchIdx < batchDefs.length && ministryOffset < nonOceanMinistries.length; batchIdx++) {
    const def = batchDefs[batchIdx];
    const batchSize = Math.min(def.size, nonOceanMinistries.length - ministryOffset);
    const batch = nonOceanMinistries.slice(ministryOffset, ministryOffset + batchSize);

    if (def.mode === 'coastline') {
      // 各府省庁ごとに海岸線から1点BFSで連続配置
      for (const ministry of batch) {
        const target = targetCounts[ministry];
        let seed = -1;
        for (let f = 0; f < faceCount; f++) {
          if (assignment[f] !== -1) continue;
          for (let e = 0; e < 3; e++) {
            const nb = adjacency[f * 3 + e];
            if (nb !== -1 && assignment[nb] !== -1 && assignment[nb] !== oceanIdx) {
              seed = f; break;
            }
          }
          if (seed !== -1) break;
        }
        if (seed === -1) break;
        const q = [seed];
        assignment[seed] = ministry;
        let assigned = 1, head = 0;
        while (assigned < target && head < q.length) {
          const cur = q[head++];
          for (let e = 0; e < 3; e++) {
            const nb = adjacency[cur * 3 + e];
            if (nb !== -1 && assignment[nb] === -1 && assigned < target) {
              assignment[nb] = ministry; assigned++; q.push(nb);
            }
          }
        }
      }
    } else {
      // split / seed モード
      const unassigned = allFaces.filter(face => assignment[face.f] === -1);
      if (unassigned.length === 0) { ministryOffset += batchSize; continue; }

      let groups;
      if (def.mode === 'split') {
        groups = splitIntoGroups([...unassigned], batch.length, 0);
      } else {
        groups = groupByNearestSeed(unassigned, def.seeds);
        if (groups.length > batch.length) {
          const indexed = groups.map((g, i) => ({ g, i, len: g.length }));
          indexed.sort((a, b) => b.len - a.len);
          groups = indexed.slice(0, batch.length).map(x => x.g);
        }
      }

      for (let g = 0; g < groups.length && g < batch.length; g++) {
        const group = groups[g];
        const ministry = batch[g];
        const target = targetCounts[ministry];

        if (group.length === 0) continue;

        let sx = 0, sy = 0, sz = 0;
        for (const f of group) { sx += f.x; sy += f.y; sz += f.z; }
        const gcx = sx / group.length, gcy = sy / group.length, gcz = sz / group.length;

        const glen = Math.sqrt(gcx*gcx + gcy*gcy + gcz*gcz);
        const gnx = gcx/glen, gny = gcy/glen, gnz = gcz/glen;
        let gupx = 0, gupy = 1, gupz = 0;
        if (Math.abs(gny) > 0.9) { gupx = 1; gupy = 0; }
        let gtx = gupy*gnz - gupz*gny, gty = gupz*gnx - gupx*gnz, gtz = gupx*gny - gupy*gnx;
        const gtLen = Math.sqrt(gtx*gtx + gty*gty + gtz*gtz);
        gtx /= gtLen; gty /= gtLen; gtz /= gtLen;
        const gbx = gny*gtz - gnz*gty, gby = gnz*gtx - gnx*gtz, gbz = gnx*gty - gny*gtx;

        const localUV = [];
        let luMin = Infinity, luMax = -Infinity, lvMin = Infinity, lvMax = -Infinity;
        for (const face of group) {
          const dx = face.x - gcx, dy = face.y - gcy, dz = face.z - gcz;
          const u = dx*gtx + dy*gty + dz*gtz;
          const v = dx*gbx + dy*gby + dz*gbz;
          localUV.push({ f: face.f, u, v });
          if (u < luMin) luMin = u;
          if (u > luMax) luMax = u;
          if (v < lvMin) lvMin = v;
          if (v > lvMax) lvMax = v;
        }
        const localArea = (luMax - luMin) * (lvMax - lvMin);
        const localDensity = localArea > 0 ? group.length / localArea : group.length;

        const R = Math.sqrt(2 * target / (3 * S3 * localDensity));

        localUV.sort((a, b) => {
          const adxA = Math.abs(a.u), adyA = Math.abs(a.v);
          const dA = Math.max(adyA / (R * S3 / 2), (S3 * adxA + adyA) / (R * S3));
          const adxB = Math.abs(b.u), adyB = Math.abs(b.v);
          const dB = Math.max(adyB / (R * S3 / 2), (S3 * adxB + adyB) / (R * S3));
          return dA - dB;
        });

        const count = Math.min(target, localUV.length);
        for (let i = 0; i < count; i++) {
          assignment[localUV[i].f] = ministry;
        }
      }
    }

    ministryOffset += batchSize;
  }

  // 未割り当て面 → 海（厚生労働省）
  for (let f = 0; f < faceCount; f++) {
    if (assignment[f] === -1) assignment[f] = oceanIdx;
  }

  // Phase 3: 境界滑らか化
  const currentCounts = new Int32Array(ministries.length);
  for (let f = 0; f < faceCount; f++) currentCounts[assignment[f]]++;

  const maxDev = new Int32Array(ministries.length);
  for (let m = 0; m < ministries.length; m++) maxDev[m] = Math.max(1, Math.round(targetCounts[m]*0.02));

  for (let iter = 0; iter < 5; iter++) {
    let swaps = 0;
    for (let f = 0; f < faceCount; f++) {
      const my = assignment[f];
      const nc = new Map();
      for (let e = 0; e < 3; e++) {
        const nb = adjacency[f*3+e];
        if (nb !== -1) nc.set(assignment[nb], (nc.get(assignment[nb])||0)+1);
      }
      let best = my, bestC = nc.get(my)||0;
      for (const [nm,cnt] of nc) if (nm !== my && cnt > bestC) { best = nm; bestC = cnt; }
      if (best !== my) {
        if (Math.abs(currentCounts[my]-1-targetCounts[my]) <= maxDev[my] &&
            Math.abs(currentCounts[best]+1-targetCounts[best]) <= maxDev[best]) {
          assignment[f] = best; currentCounts[my]--; currentCounts[best]++; swaps++;
        }
      }
    }
    if (swaps === 0) break;
  }

  return { assignment, targetCounts, centroids };
}

process.stderr.write(`Generating icosphere (level ${ICO_SUBDIVISIONS})...\n`);
const ico = generateIcosphere(ICO_SUBDIVISIONS, SPHERE_RADIUS);
process.stderr.write(`${ico.faceCount.toLocaleString()} faces. Assigning...\n`);

const { assignment, targetCounts, centroids } = assignFaces(ico, ministries);

const finalCounts = new Int32Array(ministries.length);
const sums = ministries.map(() => [0, 0, 0]);
const compCounts = ministries.map(() => 0);

for (let f = 0; f < ico.faceCount; f++) {
  const mi = assignment[f];
  finalCounts[mi]++;
  sums[mi][0] += centroids[f*3];
  sums[mi][1] += centroids[f*3+1];
  sums[mi][2] += centroids[f*3+2];
}

for (let mi = 0; mi < ministries.length; mi++) {
  const visited = new Uint8Array(ico.faceCount);
  let comps = 0;
  for (let f = 0; f < ico.faceCount; f++) {
    if (assignment[f] !== mi || visited[f]) continue;
    comps++;
    const q = [f]; visited[f] = 1; let h = 0;
    while (h < q.length) {
      const face = q[h++];
      for (let e = 0; e < 3; e++) {
        const nb = ico.adjacency[face*3+e];
        if (nb !== -1 && !visited[nb] && assignment[nb] === mi) { visited[nb] = 1; q.push(nb); }
      }
    }
  }
  compCounts[mi] = comps;
}

console.log('idx,name,target,actual,diff,components,seed_lon,seed_lat,centroid_lon,centroid_lat');
for (let mi = 0; mi < ministries.length; mi++) {
  const n = finalCounts[mi] || 1;
  const cx = sums[mi][0]/n, cy = sums[mi][1]/n, cz = sums[mi][2]/n;
  const len = Math.sqrt(cx*cx+cy*cy+cz*cz);
  const lat = Math.asin(Math.max(-1, Math.min(1, cy/len))) * 180/Math.PI;
  const lon = Math.atan2(cz, -cx) * 180/Math.PI - 180;
  const normLon = ((lon % 360) + 540) % 360 - 180;
  const m = ministries[mi];
  console.log(`${mi},${m.name},${targetCounts[mi]},${finalCounts[mi]},${finalCounts[mi]-targetCounts[mi]},${compCounts[mi]},${m.seed[0].toFixed(1)},${m.seed[1].toFixed(1)},${normLon.toFixed(1)},${lat.toFixed(1)}`);
}

process.stderr.write('Done.\n');
