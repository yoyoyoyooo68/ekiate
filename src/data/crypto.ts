// 合言葉から鍵を作り AES-GCM で暗号化・復号する（Web Crypto。ブラウザと Node 20+ で共通）
// 形式: salt(16B) + iv(12B) + 暗号文

const ITERATIONS = 150_000;
const enc = new TextEncoder();

export class WrongPassphraseError extends Error {
  constructor() {
    super('合言葉が違います');
  }
}

async function deriveKey(pass: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptBytes(plain: Uint8Array, pass: string): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pass, salt);
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, plain as BufferSource));
  const out = new Uint8Array(28 + body.length);
  out.set(salt, 0);
  out.set(iv, 16);
  out.set(body, 28);
  return out;
}

export async function decryptBytes(data: Uint8Array, pass: string): Promise<Uint8Array> {
  if (data.length < 29) throw new WrongPassphraseError();
  const salt = data.slice(0, 16);
  const iv = data.slice(16, 28);
  const key = await deriveKey(pass, salt);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, data.slice(28) as BufferSource));
  } catch {
    throw new WrongPassphraseError();
  }
}
