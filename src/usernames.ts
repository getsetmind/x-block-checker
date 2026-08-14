const USERNAME_PATTERN = /^[A-Za-z0-9_]{1,15}$/;
const PROFILE_URL_PATTERN =
	/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/@?([A-Za-z0-9_]{1,15})(?:[/?#].*)?$/i;
const TOKEN_SEPARATOR_PATTERN = /[\s,]+/;

function normalizeUsername(value: string): string | null {
	const trimmed = value.trim();
	if (!trimmed) return null;

	const urlMatch = trimmed.match(PROFILE_URL_PATTERN);
	const candidate = urlMatch?.[1] ?? trimmed.replace(/^@/, "");
	return USERNAME_PATTERN.test(candidate) ? candidate : null;
}

export function parseUsernames(values: readonly string[]): string[] {
	const usernames: string[] = [];
	const seen = new Set<string>();

	for (const value of values) {
		for (const token of value.split(TOKEN_SEPARATOR_PATTERN)) {
			const username = normalizeUsername(token);
			if (!username) continue;

			const key = username.toLowerCase();
			if (seen.has(key)) continue;

			seen.add(key);
			usernames.push(username);
		}
	}

	return usernames;
}
