/**
 * Structured log dengan redaksi (Blueprint §13.1 "hindari menyertakan token, alamat lengkap,
 * atau data sensitif ke log"). Bentuk: JSON satu baris agar mudah dikirim ke log aggregator.
 */

const SENSITIVE_KEY =
  /(password|secret|token|authorization|cookie|cvv|pan|card|apikey|api_key|session|otp|totp|address|phone|email)/i;
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

const threshold =
  LEVELS[(process.env.LOG_LEVEL as Level) in LEVELS ? (process.env.LOG_LEVEL as Level) : "info"];

function redactValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEY.test(key)) {
    if (typeof value === "string" && value.length > 0) return `[redacted:${value.length}]`;
    return "[redacted]";
  }
  return redact(value);
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>))
      out[k] = redactValue(k, v);
    return out;
  }
  if (typeof value === "bigint") return Number(value);
  return value;
}

function emit(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  if (LEVELS[level] < threshold) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    event,
    ...(Object.keys(fields).length > 0 ? { data: redact(fields) } : {}),
  };
  const serialized = JSON.stringify(line);
  if (level === "error") console.error(serialized);
  else if (level === "warn") console.warn(serialized);
  else console.log(serialized);
}

export const log = {
  debug: (event: string, fields?: Record<string, unknown>) => emit("debug", event, fields),
  info: (event: string, fields?: Record<string, unknown>) => emit("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => emit("warn", event, fields),
  error: (event: string, error?: unknown, fields: Record<string, unknown> = {}) => {
    const message = error instanceof Error ? error.message : String(error ?? "unknown");
    const code = (error as { code?: string } | undefined)?.code;
    const status = (error as { status?: number } | undefined)?.status;
    emit("error", event, {
      message,
      code,
      status,
      name: error instanceof Error ? error.name : undefined,
      ...fields,
    });
  },
};

/** Masking untuk nilai yang mungkin muncul di pesan error pengembang. */
export function mask(value: string, keep = 3): string {
  if (value.length <= keep * 2) return "*".repeat(value.length);
  return `${value.slice(0, keep)}…${value.slice(-keep)}`;
}

export function requestId(): string {
  return globalThis.crypto.randomUUID();
}
