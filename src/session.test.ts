import assert from "node:assert/strict";
import test from "node:test";
import { isSessionExpired, parseSessionRecord, redactAccountId, sessionViewOf } from "./session.js";

const RAW = JSON.stringify({
	sessionId: "2d6460e6-0e12-417d-830c-b0d4aa4370d6",
	providerId: "huawei-oauth",
	userId: "43808e95b4974fec8c4ef63d03a2819e:ce736e7b45384d6087d2901acc01bde0",
	displayName: "demo-user",
	createdAt: "2026-11-16T13:08:59.989Z",
	lastSeenAt: "2026-11-16T13:33:01.737Z",
	expiresAt: "2026-11-16T15:12:35.397Z",
	persist: true,
	accountMode: "personal",
	needsReauth: false,
	providerStateRef: "wincred://OfficeAce/auth-sessions/huawei-oauth/org:user/provider-state",
});

test("parseSessionRecord accepts the verified shape", () => {
	const record = parseSessionRecord(RAW);
	assert.ok(record);
	assert.equal(record.sessionId, "2d6460e6-0e12-417d-830c-b0d4aa4370d6");
	assert.equal(record.providerId, "huawei-oauth");
	assert.equal(record.displayName, "demo-user");
	assert.equal(record.needsReauth, false);
	assert.equal(record.accountMode, "personal");
});

test("parseSessionRecord rejects junk", () => {
	assert.equal(parseSessionRecord("not json"), undefined);
	assert.equal(parseSessionRecord("{}"), undefined);
	assert.equal(parseSessionRecord(JSON.stringify({ sessionId: "s" })), undefined);
});

test("expiry is honest: needsReauth wins, an absent expiresAt is not expired", () => {
	const record = parseSessionRecord(RAW);
	assert.ok(record);
	assert.equal(isSessionExpired(record, Date.parse("2026-11-16T14:00:00Z")), false);
	assert.equal(isSessionExpired(record, Date.parse("2026-11-16T16:00:00Z")), true);
	const noExpiry = { ...record, expiresAt: undefined };
	assert.equal(isSessionExpired(noExpiry, Date.now()), false);
	assert.equal(isSessionExpired({ ...record, needsReauth: true }, 0), true);
});

test("redactAccountId keeps at most six characters per half", () => {
	const redacted = redactAccountId(
		"43808e95b4974fec8c4ef63d03a2819e:ce736e7b45384d6087d2901acc01bde0",
	);
	assert.equal(redacted, "43808e…:ce736e…");
	assert.equal(redactAccountId("short"), "short");
});

test("sessionViewOf never returns the full account id or the token location path", () => {
	const record = parseSessionRecord(RAW);
	const view = sessionViewOf(record, Date.parse("2026-11-16T14:00:00Z"));
	assert.equal(view.signedIn, true);
	assert.equal(view.expired, false);
	assert.equal(view.account, "43808e…:ce736e…");
	assert.equal(view.providerStateRefScheme, "wincred");
	assert.ok(!JSON.stringify(view).includes("ce736e7b45384d6087d2901acc01bde0"));
});

test("sessionViewOf renders a signed-out view without inventing values", () => {
	const view = sessionViewOf(undefined);
	assert.equal(view.signedIn, false);
	assert.equal(view.account, null);
	assert.equal(view.providerId, null);
});
