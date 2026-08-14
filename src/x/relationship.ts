import type { Relationship } from "../types";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord {
	return isRecord(value) ? value : {};
}

function firstString(...values: unknown[]): string | undefined {
	return values.find((value): value is string => typeof value === "string");
}

function firstBoolean(...values: unknown[]): boolean | undefined {
	return values.find((value): value is boolean => typeof value === "boolean");
}

function extractRelationship(record: JsonRecord): Relationship | undefined {
	const legacy = asRecord(record.legacy);
	const perspective = asRecord(
		record.relationship_perspectives ?? record.relationshipPerspective,
	);
	const core = asRecord(record.core);
	const username = firstString(
		legacy.screen_name,
		core.screen_name,
		record.username,
	);
	const blockedBy = firstBoolean(
		legacy.blocked_by,
		perspective.blocked_by,
		perspective.blockedBy,
	);
	const blocking = firstBoolean(legacy.blocking, perspective.blocking);
	const protectedAccount = firstBoolean(
		legacy.protected,
		record.protected,
		record.is_protected,
	);

	if (
		!username ||
		(blockedBy === undefined &&
			blocking === undefined &&
			protectedAccount === undefined)
	)
		return;

	return {
		username,
		...(blockedBy === undefined ? {} : { blockedBy }),
		...(blocking === undefined ? {} : { blocking }),
		...(protectedAccount === undefined ? {} : { protected: protectedAccount }),
	};
}

export function extractRelationships(payload: unknown): Relationship[] {
	const relationships = new Map<string, Relationship>();
	const seen = new Set<object>();

	const walk = (value: unknown): void => {
		if (typeof value !== "object" || value === null || seen.has(value)) return;
		seen.add(value);

		if (Array.isArray(value)) {
			for (const child of value) walk(child);
			return;
		}
		if (!isRecord(value)) return;

		const relationship = extractRelationship(value);
		if (relationship)
			relationships.set(relationship.username.toLowerCase(), relationship);

		for (const child of Object.values(value)) walk(child);
	};

	walk(payload);
	return [...relationships.values()];
}
