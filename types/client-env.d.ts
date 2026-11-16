/**
 * The desktop shell's browser environment for `src/client.js`.
 *
 * `client.js` is loaded as a plain CJS-shaped script (NOT an ES module): the
 * host registers it through `window.__ModuleLoader__.load({ id, factory })`
 * and the factory receives the host's `require`, which serves the packages
 * listed in `package.json` → `dsh.client.inject` plus react.
 *
 * The React surface is declared minimally on purpose: this repository has no
 * React dependency (the host supplies it), so the declarations below are the
 * contract the card actually uses, not a copy of React's full types.
 */

interface Window {
	__ModuleLoader__: {
		load(options: { id: string; factory: (require: (id: string) => any) => unknown }): void;
	};
}

interface OfficeAceReact {
	useState(initial?: any): [any, (next: any) => void];
	useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
	useCallback<T extends (...args: any[]) => any>(fn: T, deps: readonly unknown[]): T;
}

interface OfficeAceJsxRuntime {
	jsx(type: any, props?: any, key?: any): any;
	jsxs(type: any, props?: any, key?: any): any;
	Fragment: any;
}

declare function require(id: "react"): OfficeAceReact;
declare function require(id: "react/jsx-runtime"): OfficeAceJsxRuntime;
declare function require(id: string): any;

/**
 * Ambient module declarations so `tsc` can resolve the two host-injected
 * specifiers without installing React. The surface mirrors `OfficeAceReact` /
 * `OfficeAceJsxRuntime` above and is intentionally minimal.
 */
declare module "react" {
	export function useState(initial?: any): [any, (next: any) => void];
	export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
	export function useCallback<T extends (...args: any[]) => any>(fn: T, deps: readonly unknown[]): T;
}

declare module "react/jsx-runtime" {
	export function jsx(type: any, props?: any, key?: any): any;
	export function jsxs(type: any, props?: any, key?: any): any;
	export const Fragment: any;
}
