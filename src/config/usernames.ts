const maxInputLength = 65536;
const maxUsernames = 1000;
const usernamePattern = /^[A-Za-z0-9_]{1,15}$/;

/**
 * Xのユーザー名として有効な形式かを判定する
 *
 * @param value - 検証する文字列
 */
export function isUsername(value: string): boolean {
	return usernamePattern.test(value);
}

function normalizeUsername(value: string): string | null {
	const trimmed = value.trim();
	if (!trimmed) return null;

	const urlMatch = trimmed.match(
		/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/@?([A-Za-z0-9_]{1,15})(?:[/?#].*)?$/i,
	);
	const candidate = urlMatch?.[1] ?? trimmed.replace(/^@/, "");
	return isUsername(candidate) ? candidate : null;
}

function addUsername(
	token: string,
	seen: Set<string>,
	usernames: string[],
): void {
	if (!token) return;
	const username = normalizeUsername(token);
	if (!username)
		throw new Error(
			"ユーザー名は英数字とアンダースコアの1〜15文字、またはXのプロフィールURLで指定してください",
		);

	const key = username.toLowerCase();
	if (seen.has(key)) return;

	seen.add(key);
	usernames.push(username);
	if (usernames.length > maxUsernames)
		throw new Error(`ユーザー名は最大${maxUsernames}件まで指定できます`);
}

/**
 * 改行、空白、カンマ区切りの入力を重複のないユーザー名一覧へ変換する
 *
 * @param values - 区切りを含む入力の一覧
 */
export function parseUsernames(values: readonly string[]): string[] {
	const usernames: string[] = [];
	const seen = new Set<string>();
	let inputLength = 0;

	for (const value of values) {
		inputLength += value.length;
		if (inputLength > maxInputLength)
			throw new Error("ユーザー名入力が長すぎます");
		for (const token of value.split(/[\s,]+/)) {
			addUsername(token, seen, usernames);
		}
	}

	return usernames;
}
