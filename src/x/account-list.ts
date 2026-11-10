import type { HTTPRequest, HTTPResponse, Page } from "puppeteer-core";
import type { Account, AccountListCollection } from "../account-lists/types";

/**
 * 一覧取得で参照するHTTPレスポンスの契約
 */
export type AccountListResponse = Pick<
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

/**
 * 一覧取得に必要なページ遷移、通信捕捉、再送の契約
 */
export type AccountListPage = Pick<Page, "goto" | "url"> & {
	waitForResponse(
		predicate: (response: AccountListResponse) => boolean,
		options: { timeout: number; signal?: AbortSignal },
	): Promise<AccountListResponse>;
	evaluate<T>(
		fn: (input: FetchInput) => Promise<T>,
		input: FetchInput,
	): Promise<T>;
};

/**
 * 一覧種別ごとの通信識別、レスポンス解析、ページ送りの契約
 */
export interface AccountListAdapter {
	pageUrl: string;
	matchesResponse(response: AccountListResponse): boolean;
	source(url: URL): AccountListCollection["source"];
	readPage(
		payload: unknown,
		source: AccountListCollection["source"],
	): { accounts: Account[]; nextCursor: string | null };
	loadPage?(
		cursor: string,
		timeoutMs: number,
	): Promise<Pick<AccountListResponse, "status" | "headers" | "json">>;
	advanceCursor(
		url: URL,
		source: AccountListCollection["source"],
		cursor: string,
	): void;
}

interface AccountListReadOptions {
	adapter: AccountListAdapter;
	checkpoint?: AccountListCollection;
	onProgress?: (progress: AccountListCollection) => Promise<void>;
	pageLimit?: number;
}

class AccountListHttpError extends Error {
	readonly retryAt: string | undefined;

	constructor(
		readonly status: number,
		headers: Record<string, string>,
	) {
		super(`アカウント一覧を全件取得できませんでした（HTTP ${status}）`);
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
	page: AccountListPage,
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
		throw new AccountListHttpError(response.status, {
			"retry-after": response.retryAfter ?? "",
			"x-rate-limit-reset": response.reset ?? "",
		});
	}
	return JSON.parse(response.text) as unknown;
}

function initialProgress(
	source: AccountListCollection["source"],
	previous?: AccountListCollection,
): AccountListCollection {
	if (previous && previous.source !== source) {
		throw new Error(
			"アカウント一覧の取得方式が変わりました。再開位置は使用できません",
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
	previous: AccountListCollection,
	payload: unknown,
	adapter: AccountListAdapter,
): AccountListCollection {
	const current = adapter.readPage(payload, previous.source);
	const accounts = new Map(
		previous.accounts.map((account) => [account.id, account]),
	);
	for (const account of current.accounts) {
		accounts.set(account.id, account);
	}
	const complete = current.nextCursor === null;
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
		throw new Error("アカウント一覧のページ送りが停止しました");
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
	progress?: AccountListCollection,
): AccountListCollection | undefined {
	if (
		!(error instanceof AccountListHttpError) ||
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

async function collectAccountListPages(
	page: AccountListPage,
	url: URL,
	timeoutMs: number,
	headers: Record<string, string>,
	progress: AccountListCollection,
	payload: unknown,
	options: AccountListReadOptions,
): Promise<AccountListCollection> {
	const cursors = new Set<string>();
	if (progress.nextCursor) {
		cursors.add(progress.nextCursor);
	}
	const pageLimit = options.pageLimit ?? 25;
	for (let index = 0; index < pageLimit; index++) {
		if (progress.pages >= 10000) {
			throw new Error("アカウント一覧のページ数が上限に達しました");
		}
		const next = nextProgress(progress, payload, options.adapter);
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
			throw new Error("アカウント一覧の再開位置が不正です");
		}
		payload = await loadPage(
			page,
			url,
			headers,
			timeoutMs,
			progress,
			options.adapter,
		);
	}
	throw new Error("アカウント一覧のページ数設定が不正です");
}

async function startingPayload(
	page: AccountListPage,
	response: AccountListResponse,
	url: URL,
	timeoutMs: number,
	progress: AccountListCollection,
	adapter: AccountListAdapter,
): Promise<unknown> {
	if (progress.pages === 0) {
		return response.json();
	}
	if (!progress.nextCursor) {
		throw new Error("アカウント一覧の再開位置が不正です");
	}
	return loadPage(
		page,
		url,
		replayHeaders(response.request().headers()),
		timeoutMs,
		progress,
		adapter,
	);
}

async function loadPage(
	page: AccountListPage,
	url: URL,
	headers: Record<string, string>,
	timeoutMs: number,
	progress: AccountListCollection,
	adapter: AccountListAdapter,
): Promise<unknown> {
	if (!progress.nextCursor) {
		throw new Error("アカウント一覧の再開位置が不正です");
	}
	if (adapter.loadPage) {
		const response = await adapter.loadPage(progress.nextCursor, timeoutMs);
		if (response.status() !== 200) {
			throw new AccountListHttpError(response.status(), response.headers());
		}
		return response.json();
	}
	adapter.advanceCursor(url, progress.source, progress.nextCursor);
	return fetchNextPage(page, url.toString(), headers, timeoutMs);
}

function accountListReadError(): Error {
	return new Error(
		"アカウント一覧を全件取得できませんでした。保存済みの進捗から再開できます。認証、通信、Xの画面変更を確認してください",
	);
}

/**
 * @param page - 一覧取得に使うページ
 * @param timeoutMs - ページ遷移と通信の待機上限（ミリ秒）
 * @param options - 一覧種別のアダプターと再開・進捗通知・取得上限の設定
 * @returns 取得済みアカウントと完了状態、再開位置を含む進捗
 */
export async function readAccountList(
	page: AccountListPage,
	timeoutMs: number,
	options: AccountListReadOptions,
): Promise<AccountListCollection> {
	let progress = options.checkpoint;
	if (progress?.complete) {
		return progress;
	}
	if (progress?.retryAt && Date.parse(progress.retryAt) > Date.now()) {
		return progress;
	}
	const { adapter } = options;
	const pageLimit = options.pageLimit ?? 25;
	validatePageLimit(pageLimit);
	const onProgress = async (next: AccountListCollection): Promise<void> => {
		progress = next;
		await options.onProgress?.(next);
	};
	try {
		const [response] = await Promise.all([
			page.waitForResponse((response) => adapter.matchesResponse(response), {
				timeout: timeoutMs,
			}),
			page.goto(adapter.pageUrl, {
				waitUntil: "domcontentloaded",
				timeout: timeoutMs,
			}),
		]);
		if (/\/(?:i\/flow\/login|login)(?:[/?#]|$)/.test(page.url())) {
			throw new Error("Xの認証が切れています");
		}
		const url = new URL(response.url());
		progress = initialProgress(adapter.source(url), progress);
		if (response.status() !== 200) {
			throw new AccountListHttpError(response.status(), response.headers());
		}
		const payload = await startingPayload(
			page,
			response,
			url,
			timeoutMs,
			progress,
			adapter,
		);
		return await collectAccountListPages(
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
			try {
				await options.onProgress?.(interrupted);
			} catch {
				// biome-ignore lint/style/useErrorCause: 内部URLや認証情報を含む例外をcauseに保持しない
				throw accountListReadError();
			}
			return interrupted;
		}
		if (error instanceof AccountListHttpError) {
			throw error;
		}
		throw accountListReadError();
	}
}
