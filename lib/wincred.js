/**
 * Reading OfficeAce's provider state out of Windows Credential Manager.
 *
 * OfficeAce stores the account's oauth/provider state as a "manifest" credential
 * plus N chunk credentials, all in the user's Windows Credential Manager
 * (`wincred://OfficeAce/auth-sessions/<provider>/<org>:<user>/provider-state`):
 *
 *   <target>                  UTF-16LE JSON  {schemaVersion, encoding:"base64",
 *                                              storageId, chunkCount}
 *   <target>/chunks/<id>/<n>  UTF-16LE text   one segment of the base64 payload
 *
 * Concatenating the chunks in index order and base64-decoding yields the
 * plaintext provider-state JSON (verified on OfficeAce 1.8.1 — see
 * docs/protocol.md §1.3). `CredRead` itself does the DPAPI decryption; this
 * module never touches DPAPI or a native addon.
 *
 * Transport is a short-lived PowerShell child process, because Node has no
 * built-in credential API. The constraint the plugin keeps:
 *
 * - READ ONLY: only `CredRead`, never `CredWrite`/`CredDelete`;
 * - nothing is written to disk by this module;
 * - only the decoded JSON is handed back, and it never enters a log line, a
 *   web route response, or an error message.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
/** `wincred://OfficeAce/...` → `OfficeAce/...` (the Credential Manager target). */
export function wincredTargetOf(providerStateRef) {
    if (providerStateRef === undefined)
        return undefined;
    const match = /^wincred:\/\/(.+)$/u.exec(providerStateRef.trim());
    if (match === null)
        return undefined;
    const target = (match[1] ?? "").replace(/\/+$/u, "");
    return target === "" ? undefined : target;
}
/** Parse the manifest text (a JSON object) or reject it. */
export function parseManifest(text) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        return undefined;
    }
    if (typeof parsed !== "object" || parsed === null)
        return undefined;
    const row = parsed;
    const storageId = typeof row.storageId === "string" ? row.storageId.trim() : "";
    const chunkCount = Number(row.chunkCount);
    if (row.encoding !== "base64")
        return undefined;
    if (storageId === "" || !/^[0-9a-zA-Z_-]+$/u.test(storageId))
        return undefined;
    if (!Number.isInteger(chunkCount) || chunkCount <= 0 || chunkCount > 64)
        return undefined;
    return {
        schemaVersion: Number(row.schemaVersion) || 0,
        encoding: "base64",
        storageId,
        chunkCount,
    };
}
/**
 * Concatenate the chunk texts and base64-decode the result.
 *
 * @throws when the payload is not valid base64
 */
export function decodeProviderStateText(chunks) {
    const joined = chunks.join("");
    const bytes = Buffer.from(joined, "base64");
    if (bytes.length === 0)
        throw new Error("provider state payload is empty");
    return bytes.toString("utf8");
}
/** Parse the decoded provider state document. */
export function parseProviderState(text) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        return undefined;
    }
    if (typeof parsed !== "object" || parsed === null)
        return undefined;
    const state = parsed.providerState;
    if (typeof state !== "object" || state === null)
        return undefined;
    return parsed;
}
function textOf(value) {
    if (typeof value !== "string")
        return undefined;
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
}
/**
 * Extract the model gateway from a provider state.
 *
 * Verified fields on OfficeAce 1.8.1:
 * `providerState.modelInfo.model_api_url_base` is a host (no scheme) and
 * `modelInfo.model_auth_info.model_app_key` / `model_app_secret` are the
 * app-key pair the gateway accepts (HTTP Basic). The gateway serves the
 * OpenAI-compatible API under `/v1`.
 */
export function modelGatewayOf(doc) {
    const modelInfo = doc?.providerState?.modelInfo;
    if (modelInfo === undefined)
        return undefined;
    const rawHost = textOf(modelInfo.model_api_url_base);
    const appKey = textOf(modelInfo.model_auth_info?.model_app_key);
    const appSecret = textOf(modelInfo.model_auth_info?.model_app_secret);
    if (rawHost === undefined || appKey === undefined || appSecret === undefined)
        return undefined;
    const host = rawHost.replace(/^https?:\/\//u, "").replace(/\/+$/u, "");
    if (host === "")
        return undefined;
    const state = doc?.providerState;
    return {
        host,
        baseUrl: `https://${host}/v1`,
        appKey,
        appSecret,
        accountId: textOf(state?.accountId) ?? textOf(state?.user_id),
        userName: textOf(state?.userName),
        expiresAt: textOf(state?.credentialV3?.expires_at) ?? textOf(state?.credential?.expires_at),
    };
}
// ---------------------------------------------------------------------------
// PowerShell transport
// ---------------------------------------------------------------------------
const CRED_ADD_TYPE = `
Add-Type -Namespace OfficeAce -Name Cred -MemberDefinition @'
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
public struct CREDENTIAL {
  public uint Flags;
  public uint Type;
  public string TargetName;
  public string Comment;
  public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
  public uint CredentialBlobSize;
  public IntPtr CredentialBlob;
  public uint Persist;
  public uint AttributeCount;
  public IntPtr Attributes;
  public string TargetAlias;
  public string UserName;
}
[DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
public static extern bool CredRead(string target, uint type, uint reservedFlag, out IntPtr credentialPtr);
[DllImport("advapi32.dll", SetLastError = true)]
public static extern bool CredFree(IntPtr buffer);
'@ -Language CSharp
`;
const READ_SCRIPT = `
$ErrorActionPreference = 'Stop'
${CRED_ADD_TYPE}
function Read-CredText([string]$target) {
  $ptr = [IntPtr]::Zero
  if (-not [OfficeAce.Cred]::CredRead($target, 1, 0, [ref]$ptr)) {
    throw "CredRead win32=$([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }
  try {
    $cred = [Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][OfficeAce.Cred+CREDENTIAL])
    if ($cred.CredentialBlobSize -eq 0) { return '' }
    $buf = New-Object byte[] $cred.CredentialBlobSize
    [Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $buf, 0, $cred.CredentialBlobSize)
    return [System.Text.Encoding]::Unicode.GetString($buf)
  } finally {
    [OfficeAce.Cred]::CredFree($ptr) | Out-Null
  }
}
$manifestText = Read-CredText '__TARGET__'
$manifest = $manifestText | ConvertFrom-Json
$chunks = @()
for ($i = 0; $i -lt $manifest.chunkCount; $i++) {
  $chunks += Read-CredText ('__TARGET__/chunks/' + $manifest.storageId + '/' + $i)
}
Write-Output (ConvertTo-Json -Compress @{ manifest = $manifestText; chunks = $chunks })
`;
/** Escape a value for a single-quoted PowerShell literal. */
function psLiteral(value) {
    return value.replace(/'/gu, "''");
}
/** The exact PowerShell program one read runs (exposed for diagnostics/tests). */
export function buildReadScript(credentialTarget) {
    return READ_SCRIPT.replaceAll("__TARGET__", psLiteral(credentialTarget));
}
function powershellPath() {
    if (process.platform !== "win32")
        return undefined;
    const root = process.env.SystemRoot ?? "C:\\Windows";
    const candidate = join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    if (existsSync(candidate))
        return candidate;
    return "powershell.exe";
}
function encodeCommand(script) {
    return Buffer.from(script, "utf16le").toString("base64");
}
/** The default transport: PowerShell `-EncodedCommand`, stdout only. */
async function execPowerShell(encodedCommand) {
    const executable = powershellPath();
    if (executable === undefined) {
        return { ok: false, stdout: "", error: "wincred_unsupported_platform" };
    }
    return new Promise((resolve) => {
        try {
            execFile(executable, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodedCommand], { timeout: 20_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
                if (error !== null) {
                    resolve({ ok: false, stdout: "", error: describeExecError(error) });
                    return;
                }
                resolve({ ok: true, stdout: String(stdout ?? "") });
            });
        }
        catch (error) {
            // A sandbox/policy refusal surfaces synchronously; treat it as data.
            resolve({ ok: false, stdout: "", error: describeExecError(error) });
        }
    });
}
/** Turn a spawn failure into a short, actionable reason (no command line). */
function describeExecError(error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/EPERM|EACCES/iu.test(message)) {
        return "powerShell_blocked（当前进程不允许启动子进程，可能被沙箱/执行策略限制）";
    }
    if (/ENOENT/iu.test(message))
        return "powerShell_missing（找不到 powershell.exe）";
    return `exec_failed: ${message.slice(0, 100)}`;
}
/**
 * Create the provider-state reader.
 *
 * The returned `read` takes the `providerStateRef` recorded in OfficeAce's local
 * store and resolves it to the model gateway. It never throws for a missing or
 * unreadable credential — the caller decides what to render.
 */
export function createLocalSessionReader(options = {}) {
    const exec = options.exec ?? execPowerShell;
    async function read(providerStateRef) {
        const target = wincredTargetOf(providerStateRef);
        if (target === undefined) {
            return { ok: false, error: "target_unresolved" };
        }
        const script = buildReadScript(target);
        let result;
        try {
            result = await exec(encodeCommand(script));
        }
        catch (error) {
            return { ok: false, error: "exec_failed", detail: describeExecError(error) };
        }
        if (!result.ok) {
            return { ok: false, error: "exec_failed", detail: result.error };
        }
        let envelope;
        try {
            envelope = JSON.parse(result.stdout);
        }
        catch {
            return { ok: false, error: "transport_unparsable" };
        }
        const rows = envelope;
        if (typeof rows.manifest !== "string" || !Array.isArray(rows.chunks)) {
            return { ok: false, error: "transport_shape" };
        }
        const manifest = parseManifest(rows.manifest);
        if (manifest === undefined) {
            return { ok: false, error: "manifest_invalid" };
        }
        const chunks = rows.chunks.filter((chunk) => typeof chunk === "string");
        if (chunks.length !== manifest.chunkCount) {
            return { ok: false, error: "chunk_count_mismatch" };
        }
        let decoded;
        try {
            decoded = decodeProviderStateText(chunks);
        }
        catch {
            return { ok: false, error: "payload_undecodable" };
        }
        const doc = parseProviderState(decoded);
        if (doc === undefined) {
            return { ok: false, error: "state_unparsable" };
        }
        const gateway = modelGatewayOf(doc);
        if (gateway === undefined) {
            return { ok: false, error: "model_gateway_missing" };
        }
        return { ok: true, gateway };
    }
    return { read };
}
