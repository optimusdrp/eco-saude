import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * ARMAZENAMENTO DE ARQUIVOS (anexos das conversas)
 *
 * Sempre PRIVADO: nenhum arquivo tem link público. Quem abre um anexo passa pela
 * rota /api/anexos/<id>, que confere login, permissão e clínica a cada acesso.
 *
 *  - STORAGE_DRIVER=local (padrão em desenvolvimento): pasta no servidor
 *    (STORAGE_LOCAL_DIR, padrão apps/app/.data/anexos). NÃO serve na Vercel:
 *    o disco de lá é temporário e some a cada publicação.
 *  - STORAGE_DRIVER=s3 (produção): bucket privado na AWS, de preferência na região
 *    de São Paulo (S3_REGION=sa-east-1, dados no Brasil), com criptografia no
 *    servidor (S3_KMS_KEY_ID para usar uma chave KMS própria; sem ela, AES-256).
 *    Credenciais pelo padrão da AWS (AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY ou papel IAM).
 *  - Sem armazenamento configurado em produção: anexos ficam desligados, com aviso.
 */

export interface FileStorage {
  driver: "local" | "s3";
  put(key: string, bytes: Uint8Array, mime: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

/** Chaves geradas pelo sistema; ainda assim conferidas (nunca "..", nunca caminho absoluto). */
const KEY_RE = /^[a-z0-9][a-z0-9/_-]{10,200}$/;
function assertKey(key: string) {
  if (!KEY_RE.test(key) || key.includes("..") || key.includes("//")) throw new Error("Chave de arquivo inválida.");
}

/* ---------------------------------- Local ---------------------------------- */

function localStorage(dir: string): FileStorage {
  const full = (key: string) => {
    assertKey(key);
    const p = path.resolve(dir, key);
    if (!p.startsWith(path.resolve(dir) + path.sep)) throw new Error("Chave de arquivo inválida.");
    return p;
  };
  return {
    driver: "local",
    async put(key, bytes) {
      const p = full(key);
      await mkdir(path.dirname(p), { recursive: true, mode: 0o700 });
      await writeFile(p, bytes, { mode: 0o600 });
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(full(key)));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
    },
    async delete(key) {
      await rm(full(key), { force: true });
    },
  };
}

/* ----------------------------------- S3 ------------------------------------ */

async function s3Storage(): Promise<FileStorage> {
  const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = await import("@aws-sdk/client-s3");
  const bucket = process.env.S3_BUCKET!;
  const kms = process.env.S3_KMS_KEY_ID;
  const client = new S3Client({
    region: process.env.S3_REGION || "sa-east-1",
    // Só para testes com um S3 compatível (ex.: MinIO); em produção fica vazio
    ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true } : {}),
  });
  return {
    driver: "s3",
    async put(key, bytes, mime) {
      assertKey(key);
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: bytes,
          ContentType: mime,
          // Criptografia no servidor sempre ligada
          ...(kms ? { ServerSideEncryption: "aws:kms", SSEKMSKeyId: kms } : { ServerSideEncryption: "AES256" }),
        }),
      );
    },
    async get(key) {
      assertKey(key);
      try {
        const r = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return r.Body ? await r.Body.transformToByteArray() : null;
      } catch (e) {
        if ((e as { name?: string }).name === "NoSuchKey") return null;
        throw e;
      }
    },
    async delete(key) {
      assertKey(key);
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

/* --------------------------------- Escolha --------------------------------- */

export function storageStatus(): { ok: true; driver: "local" | "s3" } | { ok: false; reason: string } {
  const driver = process.env.STORAGE_DRIVER || (process.env.NODE_ENV === "production" ? "" : "local");
  if (driver === "s3") return process.env.S3_BUCKET ? { ok: true, driver } : { ok: false, reason: "Falta S3_BUCKET no servidor." };
  if (driver === "local") {
    if (process.env.VERCEL) return { ok: false, reason: "Na Vercel o disco é temporário: configure STORAGE_DRIVER=s3." };
    return { ok: true, driver };
  }
  return { ok: false, reason: "Anexos sem armazenamento configurado (STORAGE_DRIVER)." };
}

let cached: Promise<FileStorage> | null = null;

/** Armazenamento configurado. Lança erro claro se não houver. */
export function getStorage(): Promise<FileStorage> {
  const st = storageStatus();
  if (!st.ok) throw new Error(st.reason);
  cached ??= st.driver === "s3" ? s3Storage() : Promise.resolve(localStorage(process.env.STORAGE_LOCAL_DIR || path.join(process.cwd(), ".data", "anexos")));
  return cached;
}

/** Chave de um anexo: sem nome do paciente nem do arquivo. */
export function attachmentKey(clinicId: string, attachmentId: string, now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `clinics/${clinicId}/anexos/${y}/${m}/${attachmentId}`;
}

/** Chave temporária do simulador (o arquivo "chega" por aqui, como se viesse do provedor). */
export function simulatorKey(clinicId: string, id: string): string {
  return `clinics/${clinicId}/simulador/${id}`;
}
