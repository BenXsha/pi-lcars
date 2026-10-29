/** Error carrying an HTTP status + stable code so routes can answer precisely. */
export function httpError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}
