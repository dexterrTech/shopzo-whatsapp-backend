import { env } from "../config/env";

export class FallbackError extends Error {
  public status: number;
  public code?: string;

  constructor(message: string, status = 502, code?: string) {
    super(message);
    this.name = "FallbackError";
    this.status = status;
    this.code = code;
  }
}

type FallbackOptions<T> = {
  feature: string;
  attempt: () => Promise<T>;
  fallback: () => T | Promise<T>;
};

export async function withFallback<T>({ feature, attempt, fallback }: FallbackOptions<T>): Promise<T> {
  try {
    return await attempt();
  } catch (err: any) {
    if (env.USE_FALLBACK_WHEN_ERROR) {
      return await fallback();
    }
    const status = err?.response?.status || 500;
    const msg = err?.response?.data || err?.message || "Unknown error";
    throw new FallbackError(`[${feature}] ${msg}`, status, err?.code);
  }
}


