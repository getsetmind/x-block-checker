import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { AccountListKind } from "../src/account-lists/types";
import { readBlockingList } from "../src/x/blocking";
import { readFollowList } from "../src/x/follows";

type FollowPage = Parameters<typeof readFollowList>[0];

type NativeRequest = Parameters<Parameters<FollowPage["on"]>[1]>[0];

type BlockingPage = Parameters<typeof readBlockingList>[0];

type BlockingResponse = Awaited<ReturnType<BlockingPage["waitForResponse"]>>;

const endpoint = "https://x.com/i/api/1.1/blocks/list.json?count=20&cursor=-1";
const secret = "synthetic-token-not-to-log";
const user = (id: string, screen_name: string) => ({ id_str: id, screen_name });

function response(
	payload: unknown,
	url = endpoint,
	status = 200,
	headers: Record<string, string> = {},
): BlockingResponse {
	return {
		url: () => url,
		status: () => status,
		headers: () => headers,
		json: async () => payload,
		request: () => ({
			method: () => "GET",
			headers: () => ({
				authorization: secret,
				"x-csrf-token": secret,
				cookie: secret,
				"x-client-transaction-id": secret,
			}),
		}),
	};
}

function browserPage(
	responses: BlockingResponse[],
	currentUrl = "https://x.com/settings/blocked/all",
): BlockingPage {
	return {
		waitForResponse: async (
			predicate: (value: BlockingResponse) => boolean,
		) => {
			const matched = responses.find(predicate);
			if (!matched) {
				throw new Error(`timeout ${secret}`);
			}
			return matched;
		},
		goto: async () => null,
		url: () => currentUrl,
		evaluate: async (fn, input) => fn(input),
	};
}

function followBrowserPage(
	responses: BlockingResponse[],
	nativePayload?: (url: URL) => unknown,
	nativeStatus = 200,
	nativeHeaders: Record<string, string> = {},
): FollowPage {
	const base = browserPage(responses);
	let intercepting = false;
	const listeners = new Set<(request: NativeRequest) => void>();
	let waiting:
		| {
				predicate: (response: BlockingResponse) => boolean;
				resolve: (response: BlockingResponse) => void;
		  }
		| undefined;
	return {
		...base,
		evaluate: async () => {
			throw new Error("follow pagination must not replay fetch");
		},
		setRequestInterception: async (enabled) => {
			intercepting = enabled;
		},
		on: (_event, listener) => {
			listeners.add(listener);
		},
		off: (_event, listener) => {
			listeners.delete(listener);
		},
		waitForResponse: async (predicate, options) => {
			if (!intercepting) {
				return base.waitForResponse(predicate, options);
			}
			return new Promise((resolve, reject) => {
				waiting = { predicate, resolve };
				options.signal?.addEventListener(
					"abort",
					() => reject(new Error("aborted")),
					{ once: true },
				);
			});
		},
		goto: async () => {
			if (!intercepting) {
				return null;
			}
			for (const original of responses) {
				let handled = false;
				const request: NativeRequest = {
					url: () => original.url(),
					method: () => original.request().method(),
					headers: () => original.request().headers(),
					isInterceptResolutionHandled: () => handled,
					continue: async (overrides) => {
						handled = true;
						const effective = new URL(overrides?.url ?? original.url());
						const captured: BlockingResponse = {
							...original,
							request: () => request,
							status: () => (overrides?.url ? nativeStatus : original.status()),
							headers: () =>
								overrides?.url ? nativeHeaders : original.headers(),
							json: async () =>
								overrides?.url && nativePayload
									? nativePayload(effective)
									: original.json(),
						};
						if (waiting?.predicate(captured)) {
							waiting.resolve(captured);
						}
					},
				};
				for (const listener of listeners) {
					listener(request);
				}
			}
			return null;
		},
	};
}

let fetchMock: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | undefined;
afterEach(() => {
	fetchMock?.mockRestore();
});

function graphqlPage(
	users: { id: string; username: string }[],
	cursor?: string | string[],
	terminated = false,
	kind: AccountListKind = "blocking",
) {
	const payload = {
		data: {
			viewer: {
				timeline: {
					timeline: {
						instructions: [
							{ type: "TimelineTerminateTimeline", direction: "Top" },
							{
								type: "TimelineAddEntries",
								entries: [
									...users.map((account) => ({
										entryId: `user-${account.id}`,
										content: {
											entryType: "TimelineTimelineItem",
											itemContent: {
												itemType: "TimelineUser",
												user_results: {
													result: {
														__typename: "User",
														id: "encoded-not-rest-id",
														rest_id: account.id,
														core: { screen_name: account.username },
													},
												},
											},
										},
									})),
									...(cursor
										? (Array.isArray(cursor) ? cursor : [cursor]).map(
												(value) => ({
													entryId: "cursor-bottom",
													content: {
														entryType: "TimelineTimelineCursor",
														cursorType: "Bottom",
														value,
													},
												}),
											)
										: []),
								],
							},
							...(terminated
								? [{ type: "TimelineTerminateTimeline", direction: "Bottom" }]
								: []),
						],
					},
				},
			},
		},
	};
	if (kind === "blocking") {
		return payload;
	}
	return { data: { user: { result: payload.data.viewer } } };
}

describe("readFollowList", () => {
	test.each([429, 404])(
		"native HTTP%i preserves saved page and never parses failed response",
		async (status) => {
			const url =
				"https://x.com/i/api/graphql/fresh/Followers?variables=%7B%22userId%22%3A%22111%22%7D";
			const page = followBrowserPage(
				[
					response(
						graphqlPage(
							[{ id: "1", username: "Saved" }],
							"private-cursor",
							false,
							"followers",
						),
						url,
					),
				],
				() => {
					throw new Error("error body must not be parsed");
				},
				status,
				{ "retry-after": "60" },
			);
			const saved: number[] = [];
			const result = readFollowList(page, 5000, {
				kind: "followers",
				ownerId: "111",
				username: "Self",
				onProgress: async (progress) => {
					saved.push(progress.pages);
				},
			});
			if (status === 429) {
				await expect(result).resolves.toMatchObject({
					pages: 1,
					accounts: [
						{ id: "1", username: "Saved", url: "https://x.com/Saved" },
					],
					nextCursor: "private-cursor",
					stopReason: "rateLimit",
					complete: false,
				});
				expect(saved).toEqual([1, 1]);
			} else {
				await expect(result).rejects.toThrow("HTTP 404");
				expect(saved).toEqual([1]);
			}
		},
	);

	test.each(["complete", "rateLimit"] as const)(
		"%sの再開情報はユーザー名の再取得や通信なしで返す",
		async (state) => {
			const checkpoint = {
				version: 1 as const,
				checkedAt: "2026-01-01T00:00:00.000Z",
				startedAt: "2026-01-01T00:00:00.000Z",
				accounts: [{ id: "1", username: "Saved", url: "https://x.com/Saved" }],
				source: "graphql" as const,
				pages: 1,
				nextCursor: state === "complete" ? null : "saved-cursor",
				complete: state === "complete",
				...(state === "rateLimit"
					? {
							retryAt: new Date(Date.now() + 60000).toISOString(),
							stopReason: "rateLimit" as const,
						}
					: {}),
			};
			const result = await readFollowList(followBrowserPage([]), 5000, {
				kind: "followers",
				ownerId: "111",
				username: "",
				checkpoint,
			});
			expect(result).toBe(checkpoint);
		},
	);
	test.each(["following", "followers"] as const)(
		"%sは本人の一覧だけを捕捉して保存位置から終端まで再開する",
		async (kind) => {
			const operation = kind === "following" ? "Following" : "Followers";
			const endpointFor = (userId: string, name = operation) => {
				const url = new URL(
					`https://x.com/i/api/graphql/synthetic-query-id/${name}`,
				);
				url.searchParams.set(
					"variables",
					JSON.stringify({ userId, count: 20 }),
				);
				return url.toString();
			};
			const initial = graphqlPage(
				[{ id: "1", username: "OldName" }],
				"private-follow-cursor",
				false,
				kind,
			);
			const page = followBrowserPage([
				response(initial, endpointFor("999")),
				response(initial, endpointFor("111", "BlockedAccountsAll")),
				response(initial, endpointFor("111")),
			]);
			const navigated: string[] = [];
			page.goto = async (url) => {
				navigated.push(String(url));
				return null;
			};
			const options = { kind, username: "Self", ownerId: "111", pageLimit: 1 };
			const first = await readFollowList(page, 5000, options);
			expect(navigated).toEqual([`https://x.com/Self/${kind}`]);
			expect(first).toMatchObject({
				source: "graphql",
				pages: 1,
				nextCursor: "private-follow-cursor",
				complete: false,
			});
			const requests: URL[] = [];
			const resumedPage = followBrowserPage(
				[response(initial, endpointFor("111"))],
				(url) => {
					requests.push(url);
					return graphqlPage(
						[
							{ id: "1", username: "Renamed" },
							{ id: "2", username: "Alpha" },
						],
						undefined,
						true,
						kind,
					);
				},
			);
			const result = await readFollowList(resumedPage, 5000, {
				...options,
				checkpoint: first,
			});
			expect(result).toMatchObject({
				complete: true,
				pages: 2,
				nextCursor: null,
			});
			expect(result.accounts.map((account) => account.username)).toEqual([
				"Alpha",
				"Renamed",
			]);
			expect(requests).toHaveLength(1);
			expect(
				JSON.parse(requests[0]?.searchParams.get("variables") ?? "{}"),
			).toEqual({ userId: "111", count: 20, cursor: "private-follow-cursor" });
		},
	);

	test.each(["following", "followers"] as const)(
		"%sは別ユーザーの通信や壊れたタイムラインを成功にしない",
		async (kind) => {
			const operation = kind === "following" ? "Following" : "Followers";
			const url = new URL(
				`https://x.com/i/api/graphql/synthetic-query-id/${operation}`,
			);
			const options = { kind, username: "Self", ownerId: "111" };
			const complete = graphqlPage([], undefined, true, kind);
			const candidates = [
				[url.toString(), { userId: "999" }],
				[url.toString(), {}],
				[url.toString(), { userId: 111 }],
				[url.toString(), { userId: "111", cursor: "already-paged" }],
				[url.toString().replace("x.com", "evil.example"), { userId: "111" }],
				[url.toString().replace("https:", "http:"), { userId: "111" }],
				[
					url
						.toString()
						.replace(
							operation,
							kind === "following" ? "Followers" : "Following",
						),
					{ userId: "111" },
				],
				[endpoint, { userId: "111" }],
			] as const;
			for (const [endpoint, variables] of candidates) {
				const candidate = new URL(endpoint);
				candidate.searchParams.set("variables", JSON.stringify(variables));
				await expect(
					readFollowList(
						followBrowserPage([response(complete, candidate.toString())]),
						5000,
						options,
					),
				).rejects.toThrow("全件取得できません");
			}
			url.searchParams.set("variables", JSON.stringify({ userId: "111" }));
			await expect(
				readFollowList(
					followBrowserPage([
						response(graphqlPage([], undefined, false, kind), url.toString()),
					]),
					5000,
					options,
				),
			).rejects.toThrow("全件取得できません");
		},
	);
});

describe("readBlockingList", () => {
	test("既定では25ページを保存して26ページ目の通信前に中断する", async () => {
		let requested = 0;
		fetchMock = spyOn(globalThis, "fetch").mockImplementation(
			Object.assign(
				async () => {
					requested++;
					return new Response(
						JSON.stringify({
							users: [],
							next_cursor_str: String(requested + 1),
						}),
					);
				},
				{ preconnect: fetch.preconnect },
			),
		);
		const savedPages: number[] = [];
		const result = await readBlockingList(
			browserPage([
				response({ users: [user("1", "Foo")], next_cursor_str: "1" }),
			]),
			5000,
			{
				onProgress: async (progress) => {
					savedPages.push(progress.pages);
				},
			},
		);
		expect(result).toMatchObject({
			complete: false,
			stopReason: "pageLimit",
			pages: 25,
			nextCursor: "25",
		});
		expect(requested).toBe(24);
		expect(savedPages).toHaveLength(25);
		expect(savedPages.at(-1)).toBe(25);
	});

	test.each([{ source: "rest" }, { source: "graphql" }])(
		"ページ単位で保存しプロセス再起動後も続きを取得する: $source",
		async ({ source }) => {
			const graphql = source === "graphql";
			const cursor = graphql ? "opaque-resume-cursor" : "123";
			const url = graphql
				? "https://x.com/i/api/graphql/synthetic-query-id/BlockedAccountsAll?variables=%7B%22count%22%3A20%7D"
				: endpoint;
			const firstPayload = graphql
				? graphqlPage([{ id: "1", username: "Foo" }], cursor)
				: { users: [user("1", "Foo")], next_cursor_str: cursor };
			const receipts: {
				pages: number;
				nextCursor: string | null;
				count: number;
			}[] = [];
			fetchMock = spyOn(globalThis, "fetch").mockRejectedValue(
				new Error("batch上限を超えた通信"),
			);
			const first = await readBlockingList(
				browserPage([response(firstPayload, url)]),
				5000,
				{
					pageLimit: 1,
					onProgress: async (progress) => {
						receipts.push({
							pages: progress.pages,
							nextCursor: progress.nextCursor,
							count: progress.accounts.length,
						});
					},
				},
			);
			expect(first).toMatchObject({
				complete: false,
				stopReason: "pageLimit",
				pages: 1,
				nextCursor: cursor,
			});
			expect(receipts).toEqual([{ pages: 1, nextCursor: cursor, count: 1 }]);
			expect(fetchMock).not.toHaveBeenCalled();
			const requested: URL[] = [];
			fetchMock.mockRestore();
			fetchMock = spyOn(globalThis, "fetch").mockImplementation(
				Object.assign(
					async (input: Parameters<typeof fetch>[0]) => {
						requested.push(new URL(String(input)));
						return new Response(
							JSON.stringify(
								graphql
									? graphqlPage([{ id: "2", username: "Bar" }], undefined, true)
									: { users: [user("2", "Bar")], next_cursor_str: "0" },
							),
						);
					},
					{ preconnect: fetch.preconnect },
				),
			);
			const ignored = graphql
				? graphqlPage([{ id: "99", username: "NotResumed" }], "ignored")
				: { users: [user("99", "NotResumed")], next_cursor_str: "999" };
			const second = await readBlockingList(
				browserPage([response(ignored, url)]),
				5000,
				{ checkpoint: JSON.parse(JSON.stringify(first)) },
			);
			expect(second.complete).toBeTrue();
			expect(second.pages).toBe(2);
			expect(second.startedAt).toBe(first.startedAt);
			expect(second.accounts.map((account) => account.id).sort()).toEqual([
				"1",
				"2",
			]);
			expect(requested).toHaveLength(1);
			expect(
				graphql
					? JSON.parse(requested[0]?.searchParams.get("variables") ?? "{}")
							.cursor
					: requested[0]?.searchParams.get("cursor"),
			).toBe(cursor);
		},
	);

	test("途中429でも取得済みアカウントと未取得ページのカーソルを残し解除時刻まで通信しない", async () => {
		const reset = "4102444800";
		fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(secret, {
				status: 429,
				headers: { "x-rate-limit-reset": reset },
			}),
		);
		const saved: number[] = [];
		const result = await readBlockingList(
			browserPage([
				response({ users: [user("1", "Foo")], next_cursor_str: "123" }),
			]),
			5000,
			{
				onProgress: async (progress) => {
					saved.push(progress.accounts.length);
				},
			},
		);
		expect(result).toMatchObject({
			complete: false,
			stopReason: "rateLimit",
			pages: 1,
			nextCursor: "123",
			retryAt: "2100-01-01T00:00:01.000Z",
		});
		expect(saved).toEqual([1, 1]);
		expect(result.accounts).toEqual([
			{ id: "1", username: "Foo", url: "https://x.com/Foo" },
		]);
		const blocked = await readBlockingList(browserPage([]), 5000, {
			checkpoint: result,
		});
		expect(blocked).toEqual(result);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(result)).not.toContain(secret);
	});

	test("429の中断保存に失敗しても例外の秘密値やcauseを公開しない", async () => {
		const interrupted: string[] = [];
		const result = readBlockingList(
			browserPage([response({}, endpoint, 429, { "retry-after": "60" })]),
			5000,
			{
				onProgress: async (progress) => {
					interrupted.push(progress.stopReason ?? "");
					throw new Error(secret, { cause: new Error(secret) });
				},
			},
		);
		await expect(result).rejects.toThrow("全件取得できません");
		await result.catch((error: unknown) => {
			expect(error).toBeInstanceOf(Error);
			if (!(error instanceof Error)) {
				throw error;
			}
			expect(error.message).not.toContain(secret);
			expect(error.stack).not.toContain(secret);
			expect(error.cause).toBeUndefined();
		});
		expect(interrupted).toEqual(["rateLimit"]);
	});

	test("初回429でも再実行可能な空の進捗と待機期限を返す", async () => {
		const result = await readBlockingList(
			browserPage([response({}, endpoint, 429, { "retry-after": "60" })]),
			5000,
		);
		expect(result).toMatchObject({
			complete: false,
			stopReason: "rateLimit",
			pages: 0,
			accounts: [],
			nextCursor: null,
		});
		expect(Date.parse(result.retryAt ?? "") > Date.now()).toBeTrue();
	});

	test("ページ保存に失敗した場合は次のページへ進まない", async () => {
		fetchMock = spyOn(globalThis, "fetch").mockRejectedValue(
			new Error("取得してはいけない"),
		);
		await expect(
			readBlockingList(
				browserPage([
					response({ users: [user("1", "Foo")], next_cursor_str: "123" }),
				]),
				5000,
				{
					onProgress: async () => {
						throw new Error(`保存失敗 ${secret}`);
					},
				},
			),
		).rejects.toThrow("全件取得できません");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test("実画面のBlockedAccountsAllを取得し、Top終端で停止せずBottom終端まで進む", async () => {
		const variables = { count: 20, cursor: undefined };
		const url = new URL(
			"https://x.com/i/api/graphql/synthetic-query-id/BlockedAccountsAll",
		);
		url.searchParams.set("variables", JSON.stringify(variables));
		url.searchParams.set(
			"features",
			JSON.stringify({ synthetic_feature: true }),
		);
		const requested: URL[] = [];
		fetchMock = spyOn(globalThis, "fetch").mockImplementation(
			Object.assign(
				async (input: Parameters<typeof fetch>[0]) => {
					requested.push(new URL(String(input)));
					return new Response(
						JSON.stringify(
							graphqlPage([{ id: "2", username: "Alpha" }], undefined, true),
						),
					);
				},
				{ preconnect: fetch.preconnect },
			),
		);
		const result = await readBlockingList(
			browserPage([
				response(
					graphqlPage([{ id: "1", username: "Zulu" }], "opaque-next-cursor"),
					url.toString(),
				),
			]),
			5000,
		);
		expect(result.accounts).toEqual([
			{ id: "2", username: "Alpha", url: "https://x.com/Alpha" },
			{ id: "1", username: "Zulu", url: "https://x.com/Zulu" },
		]);
		expect(requested).toHaveLength(1);
		expect(
			JSON.parse(requested[0]?.searchParams.get("variables") ?? "{}"),
		).toEqual({ count: 20, cursor: "opaque-next-cursor" });
		expect(requested[0]?.searchParams.get("features")).toBe(
			JSON.stringify({ synthetic_feature: true }),
		);
	});

	test.each([{ direction: ["Top"] }, { direction: ["Bottom"] }])(
		"型が変わったGraphQL終端命令を空一覧として成功させない: %j",
		async ({ direction }) => {
			const payload = {
				data: {
					viewer: {
						timeline: {
							timeline: {
								instructions: [
									{ type: "TimelineTerminateTimeline", direction },
								],
							},
						},
					},
				},
			};
			const url =
				"https://x.com/i/api/graphql/synthetic-query-id/BlockedAccountsAll?variables=%7B%22count%22%3A20%7D";
			await expect(
				readBlockingList(browserPage([response(payload, url)]), 5000),
			).rejects.toThrow("全件取得できません");
		},
	);

	test("空のGraphQLページでもBottomカーソルが進む間は取得を続ける", async () => {
		let pages = 0;
		fetchMock = spyOn(globalThis, "fetch").mockImplementation(
			Object.assign(
				async () => {
					pages++;
					return new Response(
						JSON.stringify(
							pages === 1
								? graphqlPage([], "next-empty")
								: graphqlPage([], undefined, true),
						),
					);
				},
				{ preconnect: fetch.preconnect },
			),
		);
		const url =
			"https://x.com/i/api/graphql/synthetic-query-id/BlockedAccountsAll?variables=%7B%22count%22%3A20%7D";
		const result = await readBlockingList(
			browserPage([
				response(graphqlPage([{ id: "1", username: "Foo" }], "first"), url),
			]),
			5000,
		);
		expect(result.accounts).toEqual([
			{ id: "1", username: "Foo", url: "https://x.com/Foo" },
		]);
		expect(pages).toBe(2);
	});

	test.each([
		{ name: "終端もカーソルもない", payload: graphqlPage([]) },
		{
			name: "矛盾する複数のBottomカーソル",
			payload: graphqlPage([], ["first", "second"], true),
		},
		{
			name: "エラー付きの空一覧",
			payload: {
				...graphqlPage([], undefined, true),
				errors: [{ message: secret }],
			},
		},
		{
			name: "instructionsがない",
			payload: { data: { viewer: { timeline: { timeline: {} } } } },
		},
		{
			name: "不正なアカウント名",
			payload: graphqlPage(
				[{ id: "1", username: "bad/name" }],
				undefined,
				true,
			),
		},
	])("GraphQLの不完全な応答を全件成功にしない: $name", async ({ payload }) => {
		const url =
			"https://x.com/i/api/graphql/synthetic-query-id/BlockedAccountsAll?variables=%7B%22count%22%3A20%7D";
		await expect(
			readBlockingList(browserPage([response(payload, url)]), 5000),
		).rejects.toThrow("全件取得できません");
	});

	test("設定の一覧を終端までページ送りし、IDで重複を除きプロフィール情報だけを返す", async () => {
		const requests: { url: URL; init: RequestInit | undefined }[] = [];
		fetchMock = spyOn(globalThis, "fetch").mockImplementation(
			Object.assign(
				async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
					requests.push({ url: new URL(String(input)), init });
					return new Response(
						JSON.stringify({
							users: [user("1", "Renamed"), user("3", "Alpha")],
							next_cursor_str: "0",
						}),
					);
				},
				{ preconnect: fetch.preconnect },
			),
		);
		const page = browserPage([
			response(
				{ users: [user("99", "Unrelated")], next_cursor_str: "0" },
				"https://evil.example/i/api/1.1/blocks/list.json",
			),
			response(
				{ users: [user("98", "Unrelated")], next_cursor_str: "0" },
				"https://x.com/i/api/1.1/blocks/ids.json",
			),
			response(
				{ users: [user("97", "Unrelated")], next_cursor_str: "0" },
				endpoint.replace("cursor=-1", "cursor=123"),
			),
			response({
				users: [user("2", "Zulu"), user("1", "OldName")],
				next_cursor_str: "9007199254740999",
			}),
		]);
		const result = await readBlockingList(page, 5000);
		expect(result.version).toBe(1);
		expect(Number.isNaN(Date.parse(result.checkedAt))).toBeFalse();
		expect(result.accounts).toEqual([
			{ id: "3", username: "Alpha", url: "https://x.com/Alpha" },
			{ id: "1", username: "Renamed", url: "https://x.com/Renamed" },
			{ id: "2", username: "Zulu", url: "https://x.com/Zulu" },
		]);
		expect(requests).toHaveLength(1);
		expect(requests[0]?.url.searchParams.get("cursor")).toBe(
			"9007199254740999",
		);
		expect(requests[0]?.url.searchParams.get("count")).toBe("20");
		expect(requests[0]?.init?.credentials).toBe("include");
		expect(requests[0]?.init?.headers).toEqual({
			authorization: secret,
			"x-csrf-token": secret,
		});
		expect(JSON.stringify(result)).not.toContain(secret);
	});

	test("空の一覧も明示的な終端がある場合だけ成功する", async () => {
		fetchMock = spyOn(globalThis, "fetch").mockRejectedValue(
			new Error("fetchしてはいけない"),
		);
		expect(
			(
				await readBlockingList(
					browserPage([response({ users: [], next_cursor: 0 })]),
					5000,
				)
			).accounts,
		).toEqual([]);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test.each([
		{ users: [] },
		{ users: [], next_cursor_str: "" },
		{ users: [], next_cursor: 9007199254740992 },
		{ users: [], next_cursor_str: "0", errors: [{ message: secret }] },
		{ users: [user("1", "bad/name")], next_cursor_str: "0" },
		{ users: [{ screen_name: "MissingId" }], next_cursor_str: "0" },
		{ users: "unexpected", next_cursor_str: "0" },
	])("未対応・不完全なレスポンスを全件成功と扱わない: %j", async (payload) => {
		await expect(
			readBlockingList(browserPage([response(payload)]), 5000),
		).rejects.toThrow("全件取得できません");
	});

	test("カーソルが循環したら部分結果を返さない", async () => {
		fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ users: [], next_cursor_str: "123" })),
		);
		await expect(
			readBlockingList(
				browserPage([
					response({ users: [user("1", "Foo")], next_cursor_str: "123" }),
				]),
				5000,
			),
		).rejects.toThrow("全件取得できません");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	test.each([401, 403, 404, 500])(
		"途中のHTTP %iを成功扱いしない",
		async (status) => {
			fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(
				new Response(secret, { status }),
			);
			await expect(
				readBlockingList(
					browserPage([
						response({ users: [user("1", "Foo")], next_cursor_str: "123" }),
					]),
					5000,
				),
			).rejects.toThrow("全件取得できません");
		},
	);

	test("初回HTTP失敗やログインへの遷移を空一覧にしない", async () => {
		await expect(
			readBlockingList(browserPage([response({}, endpoint, 403)]), 5000),
		).rejects.toThrow("全件取得できません");
		await expect(
			readBlockingList(
				browserPage(
					[response({ users: [], next_cursor_str: "0" })],
					"https://x.com/i/flow/login",
				),
				5000,
			),
		).rejects.toThrow("全件取得できません");
	});

	test("通常通信を捕捉できない場合もエラーへ秘密値を含めない", async () => {
		try {
			await readBlockingList(browserPage([]), 5000);
			throw new Error("成功してはいけない");
		} catch (error) {
			expect(String(error)).toContain("全件取得できません");
			expect(String(error)).not.toContain(secret);
		}
	});
});
