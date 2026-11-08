import type { HTTPRequest, HTTPResponse, Page } from "puppeteer-core";
import { isUsername } from "../config/usernames";
import type { BlockingAccount, BlockingCollection } from "../types";
import { readBlockingTimeline } from "./blocking-timeline";

type BlockingResponse = Pick<
	HTTPResponse,
	"url" | "status" | "json" | "headers"
> & {
	request(): Pick<HTTPRequest, "method" | "headers">;
};

type FetchInput = {
	url: string;
	headers: Record<string, string>;
	timeoutMs: number;
};

type BlockingPage = Pick<Page, "goto" | "url"> & {
	waitForResponse(
		predicate: (response: BlockingResponse) => boolean,
		options: { timeout: number },
	): Promise<BlockingResponse>;
	evaluate<T>(
		fn: (input: FetchInput) => Promise<T>,
		input: FetchInput,
	): Promise<T>;
};

interface BlockingReadOptions {
	checkpoint?: BlockingCollection;
	onProgress?: (progress: BlockingCollection) => Promise<void>;
	pageLimit?: number;
}

class BlockingHttpError extends Error {
	readonly retryAt: string | undefined;

	constructor(
		readonly status: number,
		headers: Record<string, string>,
	) {
		super(`ブロック一覧を全件取得できませんでした（HTTP ${status}）`);
		this.retryAt = status === 429 ? rateLimitRetryAt(headers) : undefined;
	}
}

function rateLimitRetryAt(headers: Record<string, string>): string {
	const now = Date.now();
	const retry = headers["retry-after"];
	const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : undefined;
	const retryTime =
		seconds === undefined ? Date.parse(retry ?? "") : now + seconds * 1000;
	const reset = Number(headers["x-rate-limit-reset"]) * 1000;
	const times = [retryTime, reset].filter(
		(time) => Number.isFinite(time) && time > now,
	);
	return new Date(
		times.length ? Math.max(...times) + 1000 : now + 15 * 60 * 1000,
	).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBlockingResponse(response: BlockingResponse): boolean {
	const url = new URL(response.url());
	let initialPage = [null, "-1"].includes(url.searchParams.get("cursor"));
	const graphql =
		url.pathname.includes("/graphql/") &&
		url.pathname.endsWith("/BlockedAccountsAll");
	if (graphql) {
		try {
			const variables: unknown = JSON.parse(
				url.searchParams.get("variables") ?? "{}",
			);
			initialPage = isRecord(variables) && variables.cursor === undefined;
		} catch {
			return false;
		}
	}
	return (
		url.protocol === "https:" &&
		["x.com", "api.x.com", "twitter.com", "api.twitter.com"].includes(
			url.hostname,
		) &&
		(graphql ||
			/^\/(?:i\/api\/)?1\.1\/blocks\/list\.json$/.test(url.pathname)) &&
		response.request().method() === "GET" &&
		initialPage
	);
}

function cursorString(value: unknown): string | undefined {
	if (typeof value === "string" && /^\d+$/.test(value)) {
		return value;
	}
	if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
		return String(value);
	}
	return undefined;
}

function readAccount(value: unknown): BlockingAccount {
	if (!isRecord(value)) {
		throw new Error("ブロック一覧のユーザー形式が未対応です");
	}
	const id = cursorString(value.id_str ?? value.id);
	const username = value.screen_name;
	if (
		!id ||
		id === "0" ||
		typeof username !== "string" ||
		!isUsername(username)
	) {
		throw new Error("ブロック一覧のユーザー形式が未対応です");
	}
	return { id, username, url: `https://x.com/${username}` };
}

function readBlockingPage(payload: unknown): {
	accounts: BlockingAccount[];
	nextCursor: string;
} {
	if (
		!isRecord(payload) ||
		"errors" in payload ||
		!Array.isArray(payload.users)
	) {
		throw new Error("ブロック一覧のレスポンス形式が未対応です");
	}
	const nextCursor = cursorString(
		payload.next_cursor_str ?? payload.next_cursor,
	);
	if (nextCursor === undefined) {
		throw new Error("ブロック一覧の終端を確認できません");
	}
	return { accounts: payload.users.map(readAccount), nextCursor };
}

function replayHeaders(
	headers: Record<string, string>,
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(headers).filter(([name]) =>
			/^(?:accept|authorization|x-csrf-token|x-twitter-.+)$/i.test(name),
		),
	);
}

async function fetchNextPage(
	page: BlockingPage,
	url: string,
	headers: Record<string, string>,
	timeoutMs: number,
): Promise<unknown> {
	const response = await page.evaluate(
		async (input) => {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
			try {
				const result = await fetch(input.url, {
					headers: input.headers,
					credentials: "include",
					redirect: "error",
					signal: controller.signal,
				});
				return {
					status: result.status,
					text: await result.text(),
					retryAfter: result.headers.get("retry-after"),
					reset: result.headers.get("x-rate-limit-reset"),
				};
			} finally {
				clearTimeout(timeout);
			}
		},
		{ url, headers, timeoutMs },
	);
	if (response.status !== 200) {
		throw new BlockingHttpError(response.status, {
			"retry-after": response.retryAfter ?? "",
			"x-rate-limit-reset": response.reset ?? "",
		});
	}
	return JSON.parse(response.text) as unknown;
}

function advanceCursor(url: URL, graphql: boolean, cursor: string): void {
	if (!graphql) {
		url.searchParams.set("cursor", cursor);
		return;
	}
	const variables: unknown = JSON.parse(
		url.searchParams.get("variables") ?? "{}",
	);
	if (!isRecord(variables)) {
		throw new Error("ブロック一覧の変数形式が未対応です");
	}
	variables.cursor = cursor;
	url.searchParams.set("variables", JSON.stringify(variables));
}

function initialProgress(
	source: BlockingCollection["source"],
	previous?: BlockingCollection,
): BlockingCollection {
	if (previous && previous.source !== source) {
		throw new Error(
			"ブロック一覧の取得方式が変わりました。再開位置は使用できません",
		);
	}
	if (previous) {
		return previous;
	}
	const now = new Date().toISOString();
	return {
		version: 1,
		checkedAt: now,
		startedAt: now,
		accounts: [],
		source,
		pages: 0,
		nextCursor: null,
		complete: false,
	};
}

function nextProgress(
	previous: BlockingCollection,
	payload: unknown,
): BlockingCollection {
	const graphql = previous.source === "graphql";
	const current = graphql
		? readBlockingTimeline(payload)
		: readBlockingPage(payload);
	const accounts = new Map(
		previous.accounts.map((account) => [account.id, account]),
	);
	for (const account of current.accounts) {
		accounts.set(account.id, account);
	}
	const complete =
		current.nextCursor === null || (!graphql && current.nextCursor === "0");
	return {
		version: 1,
		checkedAt: new Date().toISOString(),
		startedAt: previous.startedAt,
		source: previous.source,
		pages: previous.pages + 1,
		accounts: [...accounts.values()].sort((left, right) =>
			left.username.localeCompare(right.username),
		),
		complete,
		nextCursor: complete ? null : current.nextCursor,
	};
}

function rememberCursor(cursors: Set<string>, cursor: string | null): void {
	if (!cursor) {
		return;
	}
	if (cursors.has(cursor)) {
		throw new Error("ブロック一覧のページ送りが停止しました");
	}
	cursors.add(cursor);
}

function validatePageLimit(pageLimit: number): void {
	if (!Number.isInteger(pageLimit) || pageLimit < 1 || pageLimit > 100) {
		throw new Error("ページ数は1〜100で指定してください");
	}
}

function interruptedProgress(
	error: unknown,
	progress?: BlockingCollection,
): BlockingCollection | undefined {
	if (
		!(error instanceof BlockingHttpError) ||
		error.status !== 429 ||
		!progress
	) {
		return undefined;
	}
	return {
		...progress,
		complete: false,
		stopReason: "rateLimit",
		...(error.retryAt ? { retryAt: error.retryAt } : {}),
	};
}

async function collectBlockingPages(
	page: BlockingPage,
	url: URL,
	timeoutMs: number,
	headers: Record<string, string>,
	progress: BlockingCollection,
	payload: unknown,
	options: BlockingReadOptions,
): Promise<BlockingCollection> {
	const cursors = new Set<string>();
	if (progress.nextCursor) {
		cursors.add(progress.nextCursor);
	}
	const pageLimit = options.pageLimit ?? 25;
	for (let index = 0; index < pageLimit; index++) {
		if (progress.pages >= 10000) {
			throw new Error("ブロック一覧のページ数が上限に達しました");
		}
		const next = nextProgress(progress, payload);
		rememberCursor(cursors, next.nextCursor);
		progress =
			!next.complete && index + 1 === pageLimit
				? { ...next, stopReason: "pageLimit" }
				: next;
		await options.onProgress?.(progress);
		if (progress.complete || progress.stopReason === "pageLimit") {
			return progress;
		}
		if (progress.nextCursor === null) {
			throw new Error("ブロック一覧の再開位置が不正です");
		}
		advanceCursor(url, progress.source === "graphql", progress.nextCursor);
		payload = await fetchNextPage(page, url.toString(), headers, timeoutMs);
	}
	throw new Error("ブロック一覧のページ数設定が不正です");
}

async function startingPayload(
	page: BlockingPage,
	response: BlockingResponse,
	url: URL,
	timeoutMs: number,
	progress: BlockingCollection,
): Promise<unknown> {
	if (progress.pages === 0) {
		return response.json();
	}
	if (!progress.nextCursor) {
		throw new Error("ブロック一覧の再開位置が不正です");
	}
	advanceCursor(url, progress.source === "graphql", progress.nextCursor);
	return fetchNextPage(
		page,
		url.toString(),
		replayHeaders(response.request().headers()),
		timeoutMs,
	);
}

/**
 * @param page - 専用プロファイルで認証済みのページ
 * @param timeoutMs - 初回表示と各ページ取得の待機上限
 * @param options - 保存済みの再開位置とページごとの永続化処理
 */
export async function readBlockingList(
	page: BlockingPage,
	timeoutMs: number,
	options: BlockingReadOptions = {},
): Promise<BlockingCollection> {
	let progress = options.checkpoint;
	if (progress?.complete) {
		return progress;
	}
	if (progress?.retryAt && Date.parse(progress.retryAt) > Date.now()) {
		return progress;
	}
	const pageLimit = options.pageLimit ?? 25;
	validatePageLimit(pageLimit);
	const onProgress = async (next: BlockingCollection): Promise<void> => {
		progress = next;
		await options.onProgress?.(next);
	};
	try {
		const [response] = await Promise.all([
			page.waitForResponse(isBlockingResponse, { timeout: timeoutMs }),
			page.goto("https://x.com/settings/blocked/all", {
				waitUntil: "domcontentloaded",
				timeout: timeoutMs,
			}),
		]);
		if (/\/(?:i\/flow\/login|login)(?:[/?#]|$)/.test(page.url())) {
			throw new Error("Xの認証が切れています");
		}
		const url = new URL(response.url());
		progress = initialProgress(
			url.pathname.endsWith("/BlockedAccountsAll") ? "graphql" : "rest",
			progress,
		);
		if (response.status() !== 200) {
			throw new BlockingHttpError(response.status(), response.headers());
		}
		const payload = await startingPayload(
			page,
			response,
			url,
			timeoutMs,
			progress,
		);
		return await collectBlockingPages(
			page,
			url,
			timeoutMs,
			replayHeaders(response.request().headers()),
			progress,
			payload,
			{ ...options, onProgress },
		);
	} catch (error) {
		const interrupted = interruptedProgress(error, progress);
		if (interrupted) {
			await options.onProgress?.(interrupted);
			return interrupted;
		}
		if (error instanceof BlockingHttpError) {
			throw error;
		}
		// biome-ignore lint/style/useErrorCause: 内部URLや認証情報を含む例外をcauseに保持しない
		throw new Error(
			"ブロック一覧を全件取得できませんでした。保存済みの進捗から再開できます。認証、通信、Xの画面変更を確認してください",
		);
	}
}
