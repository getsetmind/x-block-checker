import type { Account } from "../account-lists/types";
import { isUsername } from "../config/usernames";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
	if (!isRecord(value)) {
		throw new Error("アカウント一覧のタイムライン形式が未対応です");
	}
	return value;
}

function readUser(content: Record<string, unknown>): Account {
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
		throw new Error("アカウント一覧のユーザー形式が未対応です");
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
					throw new Error("アカウント一覧のエントリ形式が未対応です");
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
					throw new Error("アカウント一覧の終端形式が未対応です");
				}
				terminated ||= instruction.direction !== "Top";
				break;
			case "TimelineClearCache":
				break;
			default:
				throw new Error("アカウント一覧の命令形式が未対応です");
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
		throw new Error("アカウント一覧のカーソル形式が未対応です");
	}
	if (previous !== undefined && previous !== content.value) {
		throw new Error("アカウント一覧のBottomカーソルが矛盾しています");
	}
	return content.value;
}

function readEntries(entries: unknown[]): {
	accounts: Account[];
	nextCursor: string | undefined;
} {
	const accounts: Account[] = [];
	let nextCursor: string | undefined;
	for (const value of entries) {
		const content = record(record(value).content);
		if (content.entryType === "TimelineTimelineItem") {
			accounts.push(readUser(content));
		} else if (content.entryType === "TimelineTimelineCursor") {
			nextCursor = readCursor(content, nextCursor);
		} else {
			throw new Error("アカウント一覧のエントリ形式が未対応です");
		}
	}
	return { accounts, nextCursor };
}

/**
 * @param instructions - GraphQLタイムラインの命令一覧
 * @returns 抽出したアカウントと次のカーソル（終端確認済みならnull）
 */
export function readAccountListTimeline(instructions: unknown): {
	accounts: Account[];
	nextCursor: string | null;
} {
	if (!Array.isArray(instructions)) {
		throw new Error("アカウント一覧のタイムライン形式が未対応です");
	}
	const { entries, terminated } = readInstructions(instructions);
	const { accounts, nextCursor } = readEntries(entries);
	if (terminated) {
		return { accounts, nextCursor: null };
	}
	if (nextCursor === undefined) {
		throw new Error("アカウント一覧の終端を確認できません");
	}
	return { accounts, nextCursor };
}
