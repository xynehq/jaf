// Lightweight KMS crypto helper using AWS SDK v3 via dynamic import

export type KmsConfig = {
  keyId: string; // KMS KeyId or ARN
  region?: string;
  endpoint?: string;
  encryptionContext?: Record<string, string>;
};

export type KmsCrypto = {
  encrypt: (plaintext: string | Uint8Array) => Promise<string>; // returns base64 ciphertext blob
  decrypt: (ciphertextB64: string) => Promise<string>; // returns utf8 plaintext
};

export async function createKmsCrypto(config: KmsConfig): Promise<KmsCrypto> {
  const modName = '@aws-sdk/client-kms';
  const aws = await (import(modName) as Promise<any>).catch(() => null as any);
  if (!aws) {
    throw new Error('Missing dependency @aws-sdk/client-kms. Please install it to use KMS encryption.');
  }
  const { KMSClient, EncryptCommand, DecryptCommand } = aws as any;
  const client = new KMSClient({ region: config.region, endpoint: config.endpoint });

  const toB64 = (u8: Uint8Array) => Buffer.from(u8).toString('base64');
  const fromB64 = (b64: string) => new Uint8Array(Buffer.from(b64, 'base64'));

  return {
    async encrypt(plaintext: string | Uint8Array): Promise<string> {
      const pt = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : Buffer.from(plaintext);
      const cmd = new EncryptCommand({
        KeyId: config.keyId,
        Plaintext: pt,
        EncryptionContext: config.encryptionContext,
      });
      const out = await client.send(cmd);
      if (!out.CiphertextBlob) throw new Error('KMS Encrypt returned empty CiphertextBlob');
      return toB64(out.CiphertextBlob);
    },
    async decrypt(ciphertextB64: string): Promise<string> {
      const cmd = new DecryptCommand({
        CiphertextBlob: fromB64(ciphertextB64),
        EncryptionContext: config.encryptionContext,
      });
      const out = await client.send(cmd);
      if (!out.Plaintext) throw new Error('KMS Decrypt returned empty Plaintext');
      return Buffer.from(out.Plaintext).toString('utf8');
    },
  };
}
