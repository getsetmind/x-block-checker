function normalizeUsername(value: string): string | null {
	const trimmed = value.trim();
	if (!trimmed) return null;
	const urlMatch = trimmed.match(
		/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/@?([A-Za-z0-9_]{1,15})(?:[/?#].*)?$/i,
	);
	const candidate = urlMatch?.[1] ?? trimmed.replace(/^@/, "");
	return /^[A-Za-z0-9_]{1,15}$/.test(candidate) ? candidate : null;
}

export function parseUsernames(values: string[]): string[] {
	const unique = new Map<string, string>();
	for (const value of values) {
		for (const token of value.split(/[\s,]+/)) {
			const username = normalizeUsername(token);
			if (!username) continue;
			const key = username.toLowerCase();
			if (!unique.has(key)) unique.set(key, username);
		}
	}
	return [...unique.values()];
}
