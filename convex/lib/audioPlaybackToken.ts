export const AUDIO_PLAYBACK_TOKEN_TTL_MS = 5 * 60 * 1000;

export type AudioPlaybackTokenClaims = {
  clerkOrgId: string;
  conversationId: string;
  membershipId: string;
  expiresAt: number;
};

function serializeClaims(claims: AudioPlaybackTokenClaims): string {
  return JSON.stringify([
    "audio-v2",
    claims.clerkOrgId,
    claims.conversationId,
    claims.membershipId,
    claims.expiresAt,
  ]);
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

function signatureBytes(value: string): ArrayBuffer | null {
  if (!/^[a-f0-9]{64}$/i.test(value)) return null;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < value.length; i += 2) {
    bytes[i / 2] = Number.parseInt(value.slice(i, i + 2), 16);
  }
  return bytes.buffer;
}

async function importSigningKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signAudioPlaybackToken(
  secret: string,
  claims: AudioPlaybackTokenClaims,
): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await importSigningKey(secret),
    new TextEncoder().encode(serializeClaims(claims)),
  );
  return bytesToHex(new Uint8Array(signature));
}

export async function verifyAudioPlaybackToken(
  secret: string,
  claims: AudioPlaybackTokenClaims,
  providedSignature: string,
): Promise<boolean> {
  return await verifySerialized(secret, serializeClaims(claims), providedSignature);
}

async function verifySerialized(
  secret: string,
  serialized: string,
  providedSignature: string,
): Promise<boolean> {
  const signature = signatureBytes(providedSignature);
  if (!signature) return false;
  return await crypto.subtle.verify(
    "HMAC",
    await importSigningKey(secret),
    signature,
    new TextEncoder().encode(serialized),
  );
}

/**
 * The same membership-bound signature for an AskFabric answer read aloud.
 * Its own prefix keeps a conversation token from ever passing as one.
 */
export type AskSpeechTokenClaims = {
  clerkOrgId: string;
  messageId: string;
  membershipId: string;
  expiresAt: number;
};

function serializeSpeechClaims(claims: AskSpeechTokenClaims): string {
  return JSON.stringify([
    "askspeech-v1",
    claims.clerkOrgId,
    claims.messageId,
    claims.membershipId,
    claims.expiresAt,
  ]);
}

export async function signAskSpeechToken(
  secret: string,
  claims: AskSpeechTokenClaims,
): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await importSigningKey(secret),
    new TextEncoder().encode(serializeSpeechClaims(claims)),
  );
  return bytesToHex(new Uint8Array(signature));
}

export async function verifyAskSpeechToken(
  secret: string,
  claims: AskSpeechTokenClaims,
  providedSignature: string,
): Promise<boolean> {
  return await verifySerialized(secret, serializeSpeechClaims(claims), providedSignature);
}
