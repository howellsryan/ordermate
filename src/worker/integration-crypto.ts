export type EncryptedCredentialEnvelope = {
  version: 1;
  algorithm: "A256GCM";
  keyVersion: string;
  iv: string;
  ciphertext: string;
};

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new Error("Integration token encryption key must be base64 encoded");
  }
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function importEncryptionKey(base64Key: string) {
  const raw = base64ToBytes(base64Key.trim());
  if (raw.byteLength !== 32) {
    throw new Error("Integration token encryption key must decode to exactly 32 bytes");
  }
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function additionalData(keyVersion: string) {
  return new TextEncoder().encode(`operating-layer:integration-credentials:v1:${keyVersion}`);
}

export async function encryptCredentialPayload(
  payload: Record<string, unknown>,
  base64Key: string,
  keyVersion: string,
): Promise<EncryptedCredentialEnvelope> {
  const normalizedVersion = keyVersion.trim();
  if (!normalizedVersion) throw new Error("Integration token key version is required");
  const key = await importEncryptionKey(base64Key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: additionalData(normalizedVersion), tagLength: 128 },
    key,
    plaintext,
  );
  return {
    version: 1,
    algorithm: "A256GCM",
    keyVersion: normalizedVersion,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptCredentialPayload<T extends Record<string, unknown>>(
  envelope: EncryptedCredentialEnvelope,
  base64Key: string,
  expectedKeyVersion: string,
): Promise<T> {
  if (envelope.version !== 1 || envelope.algorithm !== "A256GCM") {
    throw new Error("Unsupported integration credential envelope");
  }
  if (envelope.keyVersion !== expectedKeyVersion.trim()) {
    throw new Error(`Integration credential key version ${envelope.keyVersion} is not available`);
  }
  const key = await importEncryptionKey(base64Key);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(envelope.iv),
      additionalData: additionalData(envelope.keyVersion),
      tagLength: 128,
    },
    key,
    base64ToBytes(envelope.ciphertext),
  );
  const parsed = JSON.parse(new TextDecoder().decode(plaintext));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Integration credential payload is invalid");
  }
  return parsed as T;
}
