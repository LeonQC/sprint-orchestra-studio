export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function parseApiError(status: number, text: string): ApiError {
  let message = `Request failed (${status})`;
  if (text.trim()) {
    try {
      const body = JSON.parse(text) as { detail?: unknown; message?: unknown; error?: unknown };
      const candidate = body.detail ?? body.message ?? body.error;
      if (typeof candidate === 'string' && candidate.trim()) message = candidate.trim();
    } catch {
      // Do not place an HTML proxy page or raw JSON blob in the product UI.
    }
  }
  return new ApiError(status, message);
}
