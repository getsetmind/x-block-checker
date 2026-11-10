import type { Account, AccountListCollection } from "../account-lists/types";
import { isUsername } from "../config/usernames";
import {
	type AccountListAdapter,
	type AccountListPage,
	type AccountListResponse,
	readAccountList,
} from "./account-list";
import { readBlockingTimeline } from "./blocking-timeline";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
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

function readAccount(value: unknown): Account {
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
	accounts: Account[];
	nextCursor: string | null;
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
	return {
		accounts: payload.users.map(readAccount),
		nextCursor: nextCursor === "0" ? null : nextCursor,
	};
}

function matchesResponse(response: AccountListResponse): boolean {
	const url = new URL(response.url());
	if (
		url.protocol !== "https:" ||
		!["x.com", "api.x.com", "twitter.com", "api.twitter.com"].includes(
			url.hostname,
		) ||
		response.request().method() !== "GET"
	) {
		return false;
	}
	if (/^\/(?:i\/api\/)?1\.1\/blocks\/list\.json$/.test(url.pathname)) {
		return [null, "-1"].includes(url.searchParams.get("cursor"));
	}
	if (
		!url.pathname.includes("/graphql/") ||
		!url.pathname.endsWith("/BlockedAccountsAll")
	) {
		return false;
	}
	try {
		const variables: unknown = JSON.parse(
			url.searchParams.get("variables") ?? "{}",
		);
		return isRecord(variables) && variables.cursor === undefined;
	} catch {
		return false;
	}
}

const adapter: AccountListAdapter = {
	pageUrl: "https://x.com/settings/blocked/all",
	matchesResponse,
	source: (url) => (url.pathname.includes("/graphql/") ? "graphql" : "rest"),
	readPage: (payload, source) =>
		source === "graphql"
			? readBlockingTimeline(payload)
			: readBlockingPage(payload),
	advanceCursor(url, source, cursor) {
		if (source === "rest") {
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
	},
};

interface BlockingReadOptions {
	checkpoint?: AccountListCollection;
	onProgress?: (progress: AccountListCollection) => Promise<void>;
	pageLimit?: number;
}

/**
 * @param page - ブロック一覧の取得に使うページ
 * @param timeoutMs - ページ遷移と通信の待機上限（ミリ秒）
 * @param options - 再開情報、進捗通知、取得ページ数の上限
 * @returns ブロック一覧の取得結果と再開可能な進捗
 */
export function readBlockingList(
	page: AccountListPage,
	timeoutMs: number,
	options: BlockingReadOptions = {},
): Promise<AccountListCollection> {
	return readAccountList(page, timeoutMs, { ...options, adapter });
}
