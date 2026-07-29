/**
 * Shared client for the Go escrow service — timeouts, request-ID propagation
 * and error translation defined once instead of in four route handlers.
 */

const { NextResponse } = require('next/server');
const { logger } = require('@/lib/debug-logger');

const ESCROW_SERVICE_URL = process.env.GO_ESCROW_SERVICE_URL || 'http://localhost:4001';

// The Go service's own upstream timeout is 10s; allow a little more so a slow
// Supabase call surfaces as the service's real error rather than our timeout.
const REQUEST_TIMEOUT_MS = 12_000;

const HEADER_REQUEST_ID = 'x-request-id';

/**
 * Calls the escrow service, returning the response and its parsed body. The
 * body is returned for error statuses too — that is where the Go service puts
 * its structured error, and the UI needs the message.
 */
async function callEscrowService(path, { method = 'GET', body, request } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  // Forward the incoming request ID so one trace spans both services.
  const requestId = request?.headers?.get(HEADER_REQUEST_ID) || crypto.randomUUID();

  try {
    const response = await fetch(`${ESCROW_SERVICE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        [HEADER_REQUEST_ID]: requestId,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      cache: 'no-store',
    });

    // A body is not guaranteed, so parse defensively rather than letting a
    // JSON error mask the real status.
    let data = null;
    const text = await response.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        logger.error('Escrow service returned a non-JSON body', { path, status: response.status });
      }
    }

    return { response, data, requestId };
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new EscrowServiceUnavailable(`Escrow service timed out after ${REQUEST_TIMEOUT_MS}ms`);
    }
    // Connection refused: the Go service is not running.
    throw new EscrowServiceUnavailable(`Escrow service unreachable: ${error.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

class EscrowServiceUnavailable extends Error {
  constructor(message) {
    super(message);
    this.name = 'EscrowServiceUnavailable';
  }
}

/**
 * Translates a Go-service error into this app's shape. The status passes
 * through so the UI can tell "not the client" (403) from "nothing to claim"
 * (409); collapsing both to 500 would make the escrow UI unusable.
 */
function escrowServiceErrorResponse(response, data) {
  const detail = data?.error;
  const message =
    (typeof detail === 'object' ? detail?.message : detail) || 'Escrow service request failed';
  const code = typeof detail === 'object' ? detail?.code : undefined;

  logger.error('Escrow service returned an error', {
    status: response.status,
    code,
    requestId: detail?.request_id,
  });

  // 5xx from the escrow service is our 502: this app is fine, its dep is not.
  const status = response.status >= 500 ? 502 : response.status;

  return NextResponse.json({ error: message, code, requestId: detail?.request_id }, { status });
}

/** Maps an unreachable-service error to a 503. */
function unavailableResponse(error) {
  logger.error('Escrow service unavailable', {}, error);
  return NextResponse.json(
    {
      error: 'Escrow service is unavailable. Please try again shortly.',
      code: 'SERVICE_UNAVAILABLE',
    },
    { status: 503 },
  );
}

exports.callEscrowService = callEscrowService;
exports.escrowServiceErrorResponse = escrowServiceErrorResponse;
exports.unavailableResponse = unavailableResponse;
exports.EscrowServiceUnavailable = EscrowServiceUnavailable;
exports.ESCROW_SERVICE_URL = ESCROW_SERVICE_URL;
