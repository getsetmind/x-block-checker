import { isUsername } from "../config/usernames";
import type { BlockingAccount } from "../types";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
	if (!isRecord(value)) {
		throw new Error("ブロック一覧のタイムライン形式が未対応です");
	}
	return value;
}

function readUser(content: Record<string, unknown>): BlockingAccount {
	const item = record(content.itemContent);
	const result = record(record(item.user_results).result);
	const core = record(result.core ?? result.legacy);
	const id = result.rest_id;
	const username = core.screen_name;
	if (
		item.itemType !== "TimelineUser" ||
		result.__typename !== "User" ||
		typeof id !== "string" ||
		!/^[1-9]\d*$/.test(id) ||
		typeof username !== "string" ||
		!isUsername(username)
	) {
		throw new Error("ブロック一覧のユーザー形式が未対応です");
	}
	return { id, username, url: `https://x.com/${username}` };
}

function readInstructions(instructions: unknown[]): {
	entries: unknown[];
	terminated: boolean;
} {
	const entries: unknown[] = [];
	let terminated = false;
	for (const value of instructions) {
		const instruction = record(value);
		switch (instruction.type) {
			case "TimelineAddEntries":
				if (!Array.isArray(instruction.entries)) {
					throw new Error("ブロック一覧のエントリ形式が未対応です");
				}
				entries.push(...instruction.entries);
				break;
			case "TimelineReplaceEntry":
				entries.push(instruction.entry);
				break;
			case "TimelineTerminateTimeline":
				if (
					typeof instruction.direction !== "string" ||
					!["Top", "Bottom", "TopAndBottom"].includes(instruction.direction)
				) {
					throw new Error("ブロック一覧の終端形式が未対応です");
				}
				terminated ||= instruction.direction !== "Top";
				break;
			case "TimelineClearCache":
				break;
			default:
				throw new Error("ブロック一覧の命令形式が未対応です");
		}
	}
	return { entries, terminated };
}

function readCursor(
	content: Record<string, unknown>,
	previous: string | undefined,
): string | undefined {
	if (content.cursorType === "Top") {
		return previous;
	}
	if (
		content.cursorType !== "Bottom" ||
		typeof content.value !== "string" ||
		!content.value
	) {
		throw new Error("ブロック一覧のカーソル形式が未対応です");
	}
	if (previous !== undefined && previous !== content.value) {
		throw new Error("ブロック一覧のBottomカーソルが矛盾しています");
	}
	return content.value;
}

function readEntries(entries: unknown[]): {
	accounts: BlockingAccount[];
	nextCursor: string | undefined;
} {
	const accounts: BlockingAccount[] = [];
	let nextCursor: string | undefined;
	for (const value of entries) {
		const content = record(record(value).content);
		if (content.entryType === "TimelineTimelineItem") {
			accounts.push(readUser(content));
		} else if (content.entryType === "TimelineTimelineCursor") {
			nextCursor = readCursor(content, nextCursor);
		} else {
			throw new Error("ブロック一覧のエントリ形式が未対応です");
		}
	}
	return { accounts, nextCursor };
}

/**
 * @param payload - 通常通信で取得したブロック一覧のGraphQLレスポンス
 */
export function readBlockingTimeline(payload: unknown): {
	accounts: BlockingAccount[];
	nextCursor: string | null;
} {
	const root = record(payload);
	if ("errors" in root) {
		throw new Error("ブロック一覧の取得に失敗しました");
	}
	const data = record(root.data);
	const viewer = record(data.viewer);
	const timeline = record(record(viewer.timeline).timeline);
	if (!Array.isArray(timeline.instructions)) {
		throw new Error("ブロック一覧のタイムライン形式が未対応です");
	}
	const { entries, terminated } = readInstructions(timeline.instructions);
	const { accounts, nextCursor } = readEntries(entries);
	if (terminated) {
		return { accounts, nextCursor: null };
	}
	if (nextCursor === undefined) {
		throw new Error("ブロック一覧の終端を確認できません");
	}
	return { accounts, nextCursor };
}
