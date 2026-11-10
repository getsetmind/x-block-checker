import { describe, expect, test } from "bun:test";
import type { AccountListResponse } from "../src/x/account-list";
import {
	loadNativeAccountListPage,
	type NativeAccountListPage,
	type NativeAccountListRequest,
} from "../src/x/account-list-native";

const initialUrl =
	"https://x.com/i/api/graphql/fresh-query/Followers?variables=%7B%22userId%22%3A%22111%22%2C%22count%22%3A50%7D&features=fresh";
const secret = "synthetic-native-failure";

type Failure = "enable" | "request" | "navigation" | "response";

function fixture(failure?: Failure) {
	const listeners = new Set<(request: NativeAccountListRequest) => void>();
	const interception: boolean[] = [];
	const continued: {
		original: string;
		overrides: Parameters<NativeAccountListRequest["continue"]>[0];
	}[] = [];
	let signal: AbortSignal | undefined;
	let pending:
		| {
				predicate: (response: AccountListResponse) => boolean;
				resolve: (response: AccountListResponse) => void;
				reject: (error: unknown) => void;
		  }
		| undefined;
	let selected: AccountListResponse | undefined;
	let aborted = false;
	const emitResponse = (response: AccountListResponse) => {
		if (pending?.predicate(response)) {
			pending.resolve(response);
		}
	};
	const makeRequest = (
		url: string,
		handled = false,
	): NativeAccountListRequest => {
		const request: NativeAccountListRequest = {
			url: () => url,
			method: () => "GET",
			headers: () => ({ authorization: "synthetic-credential" }),
			isInterceptResolutionHandled: () => handled,
			continue: async (overrides) => {
				continued.push({ original: url, overrides });
				if (overrides?.url) {
					if (failure === "request") {
						throw new Error(secret);
					}
					const ownResponse: AccountListResponse = {
						url: () => url,
						status: () => 200,
						headers: () => ({}),
						json: async () => ({ cursor: "next" }),
						request: () => request,
					};
					emitResponse({ ...ownResponse, request: () => makeRequest(url) });
					selected = ownResponse;
					emitResponse(ownResponse);
				}
			},
		};
		return request;
	};
	const page: NativeAccountListPage = {
		url: () => "https://x.com/Self/followers",
		evaluate: async () => {
			throw new Error("native transport must not use fetch");
		},
		setRequestInterception: async (enabled) => {
			interception.push(enabled);
			if (enabled && failure === "enable") {
				throw new Error(secret);
			}
		},
		on: (_event, listener) => {
			listeners.add(listener);
		},
		off: (_event, listener) => {
			listeners.delete(listener);
		},
		waitForResponse: async (predicate, options) => {
			signal = options.signal;
			if (failure === "response") {
				throw new Error(secret);
			}
			return new Promise((resolve, reject) => {
				pending = { predicate, resolve, reject };
				options.signal?.addEventListener(
					"abort",
					() => {
						aborted = true;
						reject(new Error("aborted"));
					},
					{ once: true },
				);
			});
		},
		goto: async () => {
			if (!pending && failure !== "response") {
				throw new Error("response waiter must precede navigation");
			}
			if (failure === "navigation") {
				throw new Error(secret);
			}
			for (const request of [
				makeRequest(initialUrl, true),
				makeRequest("https://x.com/unrelated"),
				makeRequest(initialUrl),
				makeRequest(initialUrl),
			]) {
				for (const listener of listeners) {
					listener(request);
				}
			}
			return null;
		},
	};
	return {
		page,
		interception,
		continued,
		listeners,
		get selected() {
			return selected;
		},
		get signal() {
			return signal;
		},
		get aborted() {
			return aborted;
		},
	};
}

function load(page: NativeAccountListPage) {
	return loadNativeAccountListPage(
		page,
		"https://x.com/Self/followers",
		"saved-private-cursor",
		5000,
		(request) => request.url() === initialUrl,
		(url, cursor) => {
			const variables = JSON.parse(url.searchParams.get("variables") ?? "{}");
			variables.cursor = cursor;
			url.searchParams.set("variables", JSON.stringify(variables));
		},
	);
}

describe("native account-list transport", () => {
	test("fresh native request changes only cursor and correlates response by request identity", async () => {
		const state = fixture();
		const result = await load(state.page);
		const selected = state.selected;
		if (!selected) {
			throw new Error("native request did not produce a response");
		}
		expect(result).toBe(selected);
		expect(result.url()).toBe(initialUrl);
		const changed = state.continued.filter((item) => item.overrides);
		expect(changed).toHaveLength(1);
		expect(Object.keys(changed[0]?.overrides ?? {})).toEqual(["url"]);
		const effective = new URL(changed[0]?.overrides?.url ?? "");
		expect(JSON.parse(effective.searchParams.get("variables") ?? "{}")).toEqual(
			{ userId: "111", count: 50, cursor: "saved-private-cursor" },
		);
		effective.searchParams.set(
			"variables",
			new URL(initialUrl).searchParams.get("variables") ?? "",
		);
		expect(effective.toString()).toBe(initialUrl);
		expect(state.continued).toHaveLength(3);
		expect(state.continued.filter((item) => !item.overrides)).toHaveLength(2);
		expect(state.interception).toEqual([true, false]);
		expect(state.listeners.size).toBe(0);
		expect(state.signal?.aborted).toBeTrue();
	});
	test.each(["enable", "request", "navigation", "response"] as const)(
		"%s failure removes listener, disables interception and cancels pending waiter",
		async (failure) => {
			const state = fixture(failure);
			await expect(load(state.page)).rejects.toThrow(secret);
			expect(state.interception).toEqual([true, false]);
			expect(state.listeners.size).toBe(0);
			if (failure !== "enable") {
				expect(state.signal?.aborted).toBeTrue();
			}
			if (failure === "request" || failure === "navigation") {
				expect(state.aborted).toBeTrue();
			}
		},
	);
});
