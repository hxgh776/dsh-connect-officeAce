/**
 * `dsh-connect-officeace probe` — one real streaming chat through the gateway.
 *
 * Separate from `doctor` on purpose: this consumes quota. It exercises the same
 * OpenAI-compatible surface the shim forwards, including tool calls when
 * `--tools` is passed. Credential resolution is the production one (explicit
 * key/env first, otherwise the account's own provider state).
 *
 * Exit codes: 0 success, 2 bad usage, 3 credential missing/rejected, 4 network,
 * 5 upstream error, 1 unexpected.
 */
export {};
