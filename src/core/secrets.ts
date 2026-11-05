/**
 * Envelope encryption for provider credentials, with Web Crypto only.
 * Each value is sealed with its own random AES-256-GCM data key; that key is sealed with the master key,
 * a 32-byte Worker secret (SECRETS_MASTER_KEY, base64) that never reaches D1. Rotating the master key
 * means re-sealing the data keys, not the values.
 * The associated data binds a sealed value to its row (provider, environment, name, version), so a value
 * copied into another row does not open. Nothing here logs or returns a plaintext except `openSecret`.
 */
export interface SecretsEnv {SECRETS_MASTER_KEY?:string;SECRETS_MASTER_KEY_VERSION?:string;}
export interface Sealed {ciphertext:string;iv:string;wrappedKey:string;wrapIv:string;masterKeyVersion:number;}
export class SecretsError extends Error {
  constructor(public code:'MASTER_KEY_MISSING'|'MASTER_KEY_INVALID'|'CREDENTIAL_UNREADABLE'|'MASTER_KEY_VERSION_MISMATCH'){super(code);this.name='SecretsError';}
}
const enc=new TextEncoder(),dec=new TextDecoder();
const b64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes));
const unb64=(text:string)=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
const random=(n:number)=>crypto.getRandomValues(new Uint8Array(n));

export const masterKeyVersion=(env:SecretsEnv)=>Number(env.SECRETS_MASTER_KEY_VERSION||1);
export function masterKeyState(env:SecretsEnv):'ready'|'missing'|'invalid' {
  if (!env.SECRETS_MASTER_KEY) return 'missing';
  try {return unb64(env.SECRETS_MASTER_KEY.trim()).length===32?'ready':'invalid';} catch {return 'invalid';}
}
async function masterKey(env:SecretsEnv,usage:('encrypt'|'decrypt')[]):Promise<CryptoKey> {
  const state=masterKeyState(env);
  if (state==='missing') throw new SecretsError('MASTER_KEY_MISSING');
  if (state==='invalid') throw new SecretsError('MASTER_KEY_INVALID');
  return crypto.subtle.importKey('raw',unb64(env.SECRETS_MASTER_KEY!.trim()),{name:'AES-GCM'},false,usage);
}
export const credentialAad=(provider:string,environment:string,name:string,version:number)=>`${provider}|${environment}|${name}|${version}`;

export async function sealSecret(env:SecretsEnv,aad:string,plaintext:string):Promise<Sealed> {
  const master=await masterKey(env,['encrypt']);
  const raw=random(32);
  const dataKey=await crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt']);
  const iv=random(12),wrapIv=random(12),additionalData=enc.encode(aad);
  const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData},dataKey,enc.encode(plaintext)));
  const wrapped=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:wrapIv,additionalData},master,raw));
  raw.fill(0);
  return {ciphertext:b64(ciphertext),iv:b64(iv),wrappedKey:b64(wrapped),wrapIv:b64(wrapIv),masterKeyVersion:masterKeyVersion(env)};
}
export async function openSecret(env:SecretsEnv,aad:string,sealed:Sealed):Promise<string> {
  if (sealed.masterKeyVersion!==masterKeyVersion(env)) throw new SecretsError('MASTER_KEY_VERSION_MISMATCH');
  const master=await masterKey(env,['decrypt']);
  const additionalData=enc.encode(aad);
  try {
    const raw=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(sealed.wrapIv),additionalData},master,unb64(sealed.wrappedKey)));
    const dataKey=await crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['decrypt']);raw.fill(0);
    return dec.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(sealed.iv),additionalData},dataKey,unb64(sealed.ciphertext)));
  } catch {
    // A wrong key, a tampered value or a value moved to another row all look the same from here, on purpose.
    throw new SecretsError('CREDENTIAL_UNREADABLE');
  }
}
