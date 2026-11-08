import type { HTTPResponse, Page } from "puppeteer-core";
import { isUsername } from "../config/usernames";
import type { BlockingAccount, BlockingList } from "../types";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBlockingResponse(response: HTTPResponse): boolean {
	const url = new URL(response.url());
	return (
		url.protocol === "https:" &&
		["x.com", "api.x.com", "twitter.com", "api.twitter.com"].includes(
			url.hostname,
		) &&
		/^\/(?:i\/api\/)?1\.1\/blocks\/list\.json$/.test(url.pathname) &&
		response.request().method() === "GET" &&
		[null, "-1"].includes(url.searchParams.get("cursor"))
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
	page: Page,
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
				return { status: result.status, text: await result.text() };
			} finally {
				clearTimeout(timeout);
			}
		},
		{ url, headers, timeoutMs },
	);
	if (response.status !== 200) {
		throw new Error(
			`ブロック一覧の取得に失敗しました（HTTP ${response.status}）`,
		);
	}
	return JSON.parse(response.text) as unknown;
}

/**
 * @param page - 専用プロファイルで認証済みのページ
 * @param timeoutMs - 初回表示と各ページ取得の待機上限
 */
export async function readBlockingList(
	page: Page,
	timeoutMs: number,
): Promise<BlockingList> {
	try {
		const [response] = await Promise.all([
			page.waitForResponse(isBlockingResponse, { timeout: timeoutMs }),
			page.goto("https://x.com/settings/blocked/all", {
				waitUntil: "domcontentloaded",
				timeout: timeoutMs,
			}),
		]);
		if (/\/(?:i\/flow\/login|login)(?:[/?#]|$)/.test(page.url())) {
			throw new Error("Xの認証が切れています。authを再実行してください");
		}
		if (response.status() !== 200) {
			throw new Error("ブロック一覧の初回取得に失敗しました");
		}
		const url = new URL(response.url());
		const headers = replayHeaders(response.request().headers());
		const accounts = new Map<string, BlockingAccount>();
		const cursors = new Set<string>();
		let payload: unknown = await response.json();
		for (let pageIndex = 0; pageIndex < 10000; pageIndex++) {
			const current = readBlockingPage(payload);
			for (const account of current.accounts) {
				accounts.set(account.id, account);
			}
			if (current.nextCursor === "0") {
				return {
					version: 1,
					checkedAt: new Date().toISOString(),
					accounts: [...accounts.values()].sort((left, right) =>
						left.username.localeCompare(right.username),
					),
				};
			}
			if (cursors.has(current.nextCursor)) {
				throw new Error("ブロック一覧のページ送りが停止しました");
			}
			cursors.add(current.nextCursor);
			url.searchParams.set("cursor", current.nextCursor);
			payload = await fetchNextPage(page, url.toString(), headers, timeoutMs);
		}
		throw new Error("ブロック一覧のページ数が上限に達しました");
	} catch {
		throw new Error(
			"ブロック一覧を全件取得できませんでした。認証、通信制限、Xの画面変更を確認してください。以前の一覧は更新しません",
		);
	}
}
