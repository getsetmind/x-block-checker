import type { Relationship } from "./types.js";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as JsonRecord)
		: {};
}

export function extractRelationships(payload: unknown): Relationship[] {
	const relationships = new Map<string, Relationship>();
	const seen = new Set<object>();
	const walk = (value: unknown): void => {
		if (typeof value !== "object" || value === null || seen.has(value)) return;
		seen.add(value);
		const record = asRecord(value);
		const legacy = asRecord(record.legacy);
		const perspective = asRecord(
			record.relationship_perspectives ?? record.relationshipPerspective,
		);
		const core = asRecord(record.core);
		const username =
			typeof legacy.screen_name === "string"
				? legacy.screen_name
				: typeof core.screen_name === "string"
					? core.screen_name
					: typeof record.username === "string"
						? record.username
						: "";
		const blockedBy =
			typeof legacy.blocked_by === "boolean"
				? legacy.blocked_by
				: typeof perspective.blocked_by === "boolean"
					? perspective.blocked_by
					: perspective.blockedBy;
		const blocking =
			typeof legacy.blocking === "boolean"
				? legacy.blocking
				: perspective.blocking;
		if (
			username &&
			(typeof blockedBy === "boolean" || typeof blocking === "boolean")
		) {
			relationships.set(username.toLowerCase(), {
				username,
				blockedBy: typeof blockedBy === "boolean" ? blockedBy : undefined,
				blocking: typeof blocking === "boolean" ? blocking : undefined,
			});
		}
		for (const child of Object.values(record)) walk(child);
	};
	walk(payload);
	return [...relationships.values()];
}
