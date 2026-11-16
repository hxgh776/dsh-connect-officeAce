import assert from "node:assert/strict";
import test from "node:test";
import {
	API_KEY_ENV,
	MISSING_CREDENTIAL_MESSAGE,
	credentialState,
	resolveCredential,
	tokenLocationOf,
} from "./credentials.js";

test("settings win over the environment", () => {
	const credential = resolveCredential({ apiKey: "from-settings" }, { [API_KEY_ENV]: "from-env" });
	assert.equal(credential.source, "settings");
	assert.equal(credential.apiKey, "from-settings");
});

test("the environment is the fallback", () => {
	const credential = resolveCredential({ apiKey: "  " }, { [API_KEY_ENV]: "from-env" });
	assert.equal(credential.source, "env");
	assert.equal(credential.apiKey, "from-env");
});

test("a missing credential throws an actionable not_signed_in error", () => {
	assert.throws(
		() => resolveCredential({}, {}),
		(error: unknown) =>
			error instanceof Error &&
			(error as { kind?: string }).kind === "not_signed_in" &&
			error.message === MISSING_CREDENTIAL_MESSAGE,
	);
});

test("credentialState explains where the real token is", () => {
	const state = credentialState({}, {});
	assert.equal(state.configured, false);
	assert.equal(state.source, null);
	assert.match(String(state.message), /wincred/u);
});

test("tokenLocationOf surfaces the verified wincred reference", () => {
	const ref = "wincred://OfficeAce/auth-sessions/huawei-oauth/org:user/provider-state";
	assert.equal(
		tokenLocationOf({
			sessionId: "s",
			providerId: "huawei-oauth",
			userId: "org:user",
			needsReauth: false,
			providerStateRef: ref,
		}),
		ref,
	);
	assert.match(tokenLocationOf(undefined), /^wincred:\/\/OfficeAce\//u);
});
