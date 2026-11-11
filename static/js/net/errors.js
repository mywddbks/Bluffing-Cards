export class ApiError extends Error {
  constructor(message, { code = "API_ERROR", status = 0, details = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class NetworkError extends Error {
  constructor(message, { code = "NETWORK_ERROR", cause = null, details = null } = {}) {
    super(message);
    this.name = "NetworkError";
    this.code = code;
    this.cause = cause;
    this.details = details;
  }
}

export function normalizeError(error) {
  if (!error) return new NetworkError("未知错误");
  if (error instanceof ApiError || error instanceof NetworkError) return error;
  return new NetworkError(error.message || String(error), { cause: error });
}
