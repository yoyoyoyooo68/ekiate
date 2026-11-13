import type { Geometry, Network } from '../types';
import { decryptBytes } from './crypto';

export type Manifest = { version: string; encrypted: boolean; geometry?: boolean };
export type LoadedData = { network: Network; timetable: ArrayBuffer; geometry: Geometry | null };

async function fetchBytes(url: string, onProgress?: (frac: number) => void): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} を取得できません (${res.status})`);
  const total = Number(res.headers.get('content-length') ?? 0);
  if (!res.body || !total) {
    const b = new Uint8Array(await res.arrayBuffer());
    onProgress?.(1);
    return b;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress?.(Math.min(1, got / total));
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export async function fetchManifest(): Promise<Manifest> {
  const res = await fetch('data/manifest.json');
  if (!res.ok) throw new Error('データが見つかりません');
  return res.json();
}

export async function loadData(
  manifest: Manifest,
  passphrase: string | null,
  onProgress?: (frac: number) => void,
): Promise<LoadedData> {
  const suffix = manifest.encrypted ? '.enc' : '';
  const progress = [0, 0];
  const report = () => onProgress?.((progress[0] * 0.1 + progress[1] * 0.9));
  const [netBytes, ttBytes] = await Promise.all([
    fetchBytes(`data/network.json${suffix}`, (f) => ((progress[0] = f), report())),
    fetchBytes(`data/timetable.bin${suffix}`, (f) => ((progress[1] = f), report())),
  ]);
  let net = netBytes;
  let tt = ttBytes;
  if (manifest.encrypted) {
    if (passphrase === null) throw new Error('合言葉が必要です');
    [net, tt] = await Promise.all([decryptBytes(netBytes, passphrase), decryptBytes(ttBytes, passphrase)]);
  }
  const network = JSON.parse(new TextDecoder().decode(net)) as Network;
  const timetable = tt.buffer.slice(tt.byteOffset, tt.byteOffset + tt.byteLength) as ArrayBuffer;
  // 線の形（公開データなので暗号化しない。無い・読めないときは駅を直線で結ぶ）
  let geometry: Geometry | null = null;
  if (manifest.geometry) {
    try {
      const res = await fetch('data/geometry.json');
      if (res.ok) geometry = (await res.json()) as Geometry;
    } catch {
      geometry = null;
    }
  }
  return { network, timetable, geometry };
}
