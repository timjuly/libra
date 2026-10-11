import type { SubtleCrypto as WorkersSubtleCrypto } from '@cloudflare/workers-types';

const encoder = new TextEncoder();
const bytes = (value: string) => encoder.encode(value);
const hex = (value: ArrayBuffer | Uint8Array) =>
  Array.from(new Uint8Array(value), (b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (value: string) => {
  if (!/^(?:[a-f0-9]{2})+$/i.test(value)) throw new StorageFormatError();
  return Uint8Array.from(value.match(/.{2}/g)!, (b) => parseInt(b, 16));
};
export class StorageFormatError extends Error {
  name = 'StorageFormatError';
}
export class StorageDecryptionError extends Error {
  name = 'StorageDecryptionError';
}
// Cache only non-extractable keys, never request objects or decrypted records.
// Include the secret and envelope version so a changed binding cannot reuse an old key.
const encryptionKeys = new Map<string, CryptoKey>();
export const random = (length = 24) => hex(crypto.getRandomValues(new Uint8Array(length)));
export const digest = async (value: string) => hex(await crypto.subtle.digest('SHA-256', bytes(value)));
export async function equal(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', bytes(a)),
    crypto.subtle.digest('SHA-256', bytes(b)),
  ]);
  // The client/test tsconfig also includes DOM's narrower SubtleCrypto type.
  return (crypto.subtle as unknown as WorkersSubtleCrypto).timingSafeEqual(left, right);
}
async function encryptionKey(secret: string, version: 1 | 2) {
  const cacheKey = `${version}:${secret}`;
  const cached = encryptionKeys.get(cacheKey);
  if (cached) return cached;
  let key: CryptoKey;
  if (version === 1) {
    // Read existing deployments without rewriting or rotating their secrets.
    const raw = await crypto.subtle.digest('SHA-256', bytes(`libra:encryption:v1:${secret}`));
    key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  } else {
    const material = await crypto.subtle.importKey('raw', bytes(secret), 'HKDF', false, ['deriveKey']);
    key = await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: bytes('libra:encryption'), info: bytes('storage:v2') },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  }
  if (encryptionKeys.size >= 4) encryptionKeys.delete(encryptionKeys.keys().next().value!);
  encryptionKeys.set(cacheKey, key);
  return key;
}
function base64(value: ArrayBuffer): string {
  const data = new Uint8Array(value);
  const chunks: string[] = [];
  for (let offset = 0; offset < data.length; offset += 8192)
    chunks.push(String.fromCharCode(...data.subarray(offset, offset + 8192)));
  return btoa(chunks.join(''));
}
function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const result = new Uint8Array(binary.length);
  // Avoid an intermediate array of millions of single-character strings.
  for (let index = 0; index < binary.length; index++) result[index] = binary.charCodeAt(index);
  return result;
}
export async function seal(secret: string, key: string, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: bytes(key) },
    await encryptionKey(secret, 2),
    bytes(JSON.stringify(value)),
  );
  return JSON.stringify({ v: 2, iv: hex(iv), data: base64(encrypted) });
}
export async function unseal<T>(secret: string, key: string, value: string): Promise<T> {
  let envelope: { v: 1 | 2; iv: string; data: string };
  let iv: Uint8Array<ArrayBuffer>;
  let data: Uint8Array<ArrayBuffer>;
  try {
    envelope = JSON.parse(value);
    if (
      !envelope ||
      ![1, 2].includes(envelope.v) ||
      typeof envelope.iv !== 'string' ||
      !/^[a-f0-9]{24}$/i.test(envelope.iv) ||
      typeof envelope.data !== 'string'
    )
      throw new StorageFormatError();
    iv = unhex(envelope.iv);
    data = envelope.v === 1 ? unhex(envelope.data) : fromBase64(envelope.data);
    if (data.length < 16) throw new StorageFormatError();
  } catch {
    throw new StorageFormatError();
  }
  const cryptoKey = await encryptionKey(secret, envelope.v);
  let decrypted: ArrayBuffer;
  try {
    decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: bytes(key) },
      cryptoKey,
      data,
    );
  } catch {
    throw new StorageDecryptionError();
  }
  try {
    return JSON.parse(new TextDecoder().decode(decrypted)) as T;
  } catch {
    throw new StorageFormatError();
  }
}
export interface PasswordHash {
  salt: string;
  hash: string;
  iterations: number;
}
export async function hashPassword(
  password: string,
  secret: string,
  salt = random(16),
  iterations = 100_000,
): Promise<PasswordHash> {
  const pepperKey = await crypto.subtle.importKey(
    'raw',
    bytes(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const peppered = await crypto.subtle.sign('HMAC', pepperKey, bytes(`libra:password:v1:${password}`));
  const material = await crypto.subtle.importKey('raw', peppered, 'PBKDF2', false, ['deriveBits']);
  const hash = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: unhex(salt), iterations, hash: 'SHA-256' },
    material,
    256,
  );
  return { salt, hash: hex(hash), iterations };
}
export async function checkPassword(
  password: string,
  secret: string,
  stored: PasswordHash,
): Promise<boolean> {
  const candidate = await hashPassword(password, secret, stored.salt, stored.iterations);
  return equal(candidate.hash, stored.hash);
}
