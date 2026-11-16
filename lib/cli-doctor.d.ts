/**
 * `dsh-connect-officeace doctor` — read-only diagnostics.
 *
 * Five checks, none of which consumes inference quota:
 *
 * 1. the OfficeAce installation and its local store are where we expect;
 * 2. the store opens and answers a query;
 * 3. a session record exists and is not expired;
 * 4. access resolves — explicit key/env, or the account's own provider state
 *    from Windows Credential Manager (this is the one that used to be "fill a
 *    key in");
 * 5. optionally, the model gateway's `/v1/models` answers (`--network`).
 *
 * Exit codes: 0 all good, 1 at least one check failed, 2 bad usage.
 */
export {};
