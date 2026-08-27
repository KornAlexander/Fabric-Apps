// Shared HTTP helpers used by route modules. Kept tiny so each route file
// can stay focused on its endpoint logic. (Copied from digital-twin server.)

/** Send a JSON response with 2-space indentation. */
export function send(res, status, data) {
  res.status(status).type("application/json; charset=utf-8").send(JSON.stringify(data, null, 2));
}

/** Write one NDJSON line to a streaming response. */
export function ndjson(res, data) {
  res.write(`${JSON.stringify(data)}\n`);
}
