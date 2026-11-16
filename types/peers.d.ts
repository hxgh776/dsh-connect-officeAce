/**
 * Ambient declarations for the packages the DSH host provides at runtime.
 *
 * `@deepseek-ai/*` and `@earendil-works/pi-ai` are peerDependencies: the
 * Harness resolves them, this plugin never bundles them. Declaring them as
 * `any` keeps our typecheck independent of the host's version-varying type
 * surface — the same convention `dsh-connect-loomy` uses in `types/peers.d.ts`.
 *
 * NOTE: this file must stay a SCRIPT (no top-level `export`), otherwise these
 * become module augmentations and stop applying to untyped imports.
 */

declare module "@deepseek-ai/schemastery";
declare module "@deepseek-ai/dsh-llm";
declare module "@deepseek-ai/dsh-llm-pi-ai";
declare module "@deepseek-ai/dsh-host-webserver";
declare module "@deepseek-ai/cordis";
declare module "@earendil-works/pi-ai";
declare module "@earendil-works/pi-ai/api/openai-completions.lazy";
