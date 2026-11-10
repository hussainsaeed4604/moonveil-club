// Shared error type for the multiplayer modules.
// Messages are scrubbed so a failed request cannot echo a key or a project URL.

export class NetError extends Error {
  constructor(message, { code = 'net_error', cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'NetError';
    this.code = code;
  }
}

export function safeMessage(text) {
  return String(text ?? '')
    .replace(/sb_(publishable|secret|service_role|service)_[A-Za-z0-9_-]+/g, '[redacted-key]')
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[redacted-jwt]')
    .replace(/https?:\/\/\S+/g, '[url]');
}

export function fromSupabase(error, fallback = 'Request failed.') {
  const code = error?.code || error?.status || 'supabase_error';
  const message = safeMessage(error?.message || fallback);
  return new NetError(message, { code: String(code) });
}
