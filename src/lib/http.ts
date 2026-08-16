export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiRequest<T>(
  path: string,
  options: {
    method?: string;
    token?: string | null;
    telegramInitData?: string;
    maxInitData?: string;
    body?: unknown;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  const isForm = typeof FormData !== "undefined" && options.body instanceof FormData;
  if (options.body !== undefined && !isForm) {
    headers["Content-Type"] = "application/json";
  }
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  if (options.telegramInitData) {
    headers.Authorization = `tma ${options.telegramInitData}`;
  }
  if (options.maxInitData) {
    headers.Authorization = `max ${options.maxInitData}`;
  }
  const response = await fetch(`/api${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined
      ? undefined
      : isForm
        ? (options.body as FormData)
        : JSON.stringify(options.body),
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      data !== null &&
      typeof data === "object" &&
      "error" in data &&
      typeof data.error === "string"
        ? data.error
        : "Request failed";
    throw new ApiError(
      message,
      response.status,
      data !== null && typeof data === "object" && "details" in data
        ? data.details
        : undefined,
    );
  }
  return data as T;
}
