/**
 * HTTP client — typed fetch wrapper for communicating with the Clover
 * backend REST API.
 *
 * All UI HTTP calls go through this module so that components never make
 * direct `fetch` calls. The client:
 *
 * - Prepends the configurable base URL to every request path
 * - Serialises request bodies as JSON and sets appropriate headers
 * - Parses the backend's `{ error, code }` error format on non-2xx
 *   responses and throws a typed {@link HttpError}
 * - Provides generic methods: {@link get}, {@link post}, {@link patch},
 *   {@link del} with typed request/response interfaces
 *
 * @module api/http.client
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default base URL for the backend REST API. */
const DEFAULT_BASE_URL = 'http://localhost:3001/api';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * The active base URL used for all requests.
 * Can be changed at runtime via {@link configure}.
 */
let baseUrl: string = DEFAULT_BASE_URL;

/**
 * Update the base URL used for all subsequent requests.
 *
 * @param url - New base URL (e.g. `http://localhost:4000/api`).
 */
export function configure(url: string): void {
  baseUrl = url;
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/** Shape of the backend's standard error response body. */
interface ErrorBody {
  error: string;
  code: string;
}

/**
 * Typed error thrown when the backend returns a non-2xx response.
 *
 * Extends the native `Error` class with {@link statusCode} and
 * {@link code} properties extracted from the backend's error payload.
 */
export class HttpError extends Error {
  /** HTTP status code of the failed response (e.g. 400, 404, 500). */
  public readonly statusCode: number;

  /** Machine-readable error code from the backend (e.g. `VALIDATION_ERROR`). */
  public readonly code: string;

  constructor(statusCode: number, message: string, code: string) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Execute a fetch request and handle error responses.
 *
 * @param path    - URL path appended to the base URL (e.g. `/sessions`).
 * @param options - Standard `RequestInit` options forwarded to `fetch`.
 * @returns The parsed JSON response body typed as `T`.
 * @throws {HttpError} When the response status is not in the 2xx range.
 */
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${baseUrl}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    let errorMessage = response.statusText || 'Request failed';
    let errorCode = 'UNKNOWN_ERROR';

    try {
      const body: ErrorBody = await response.json() as ErrorBody;
      if (body.error) {
        errorMessage = body.error;
      }
      if (body.code) {
        errorCode = body.code;
      }
    } catch {
      // Response body is not JSON — use defaults from status text
    }

    throw new HttpError(response.status, errorMessage, errorCode);
  }

  // 204 No Content — return undefined cast as T
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send a GET request.
 *
 * @param path - URL path appended to the base URL (e.g. `/sessions/abc/history`).
 * @returns The parsed JSON response body typed as `T`.
 */
export function get<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'GET' });
}

/**
 * Send a POST request with a JSON body.
 *
 * @param path - URL path appended to the base URL.
 * @param body - Request payload serialised as JSON.
 * @returns The parsed JSON response body typed as `T`.
 */
export function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * Send a PATCH request with a JSON body.
 *
 * @param path - URL path appended to the base URL.
 * @param body - Request payload serialised as JSON.
 * @returns The parsed JSON response body typed as `T`.
 */
export function patch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/**
 * Send a DELETE request with an optional JSON body.
 *
 * @param path - URL path appended to the base URL.
 * @param body - Optional request payload serialised as JSON.
 * @returns The parsed JSON response body typed as `T`.
 */
export function del<T>(path: string, body?: unknown): Promise<T> {
  const options: RequestInit = { method: 'DELETE' };

  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  return request<T>(path, options);
}
