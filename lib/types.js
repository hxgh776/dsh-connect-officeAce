/**
 * Shared shapes.
 *
 * Everything here mirrors data this plugin actually reads or writes:
 *
 * - `OfficeAceSessionRecord` — one row of OfficeAce's own local key-value store
 *   (`data/storage.sqlite`, table `oc_kv_string`, key
 *   `office-claw:oc:session:user:<org>:<user>`). Field names and value shapes
 *   were read from a real 1.8.1 install; see docs/protocol.md.
 * - `OfficeAceApiLease` — the same store's
 *   `office-claw:runtime:api-instance-lease:v1` row, which describes the local
 *   API server the desktop app runs.
 * - The rest is this plugin's own contract.
 */
export {};
