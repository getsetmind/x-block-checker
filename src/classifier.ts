import type { PageState, Relationship, Status } from "./types.js";

export const MIN_CLEAR_WAIT_MS = 5_000;

const BLOCKED_MESSAGE_PATTERN =
	/ブロックされています|あなたをブロックしました|ブロックされているため|you(?:'|’)re blocked|blocked you|has blocked you/i;
const SUSPENDED_MESSAGE_PATTERN =
	/アカウントは凍結|account (?:is|has been) suspended/i;
const NOT_FOUND_MESSAGE_PATTERN =
	/アカウントは存在しません|this account doesn(?:'|’)t exist/i;
const UNBLOCK_ACTION_PATTERN = /ブロックを解除|unblock/i;

function classifyRelationship(
	relationship: Relationship | undefined,
): Status | null {
	if (!relationship) return null;

	const { blockedBy, blocking } = relationship;
	if (blockedBy === true) return blocking === true ? "mutual" : "blocked";
	if (blockedBy === false && blocking === true) return "blocking";
	if (blockedBy === false && blocking === false) return "clear";
	return null;
}

export function classify(
	state: PageState,
	relationship: Relationship | undefined,
	elapsedMs: number,
): Status | null {
	if (BLOCKED_MESSAGE_PATTERN.test(state.text))
		return relationship?.blocking === true ? "mutual" : "blocked";
	if (SUSPENDED_MESSAGE_PATTERN.test(state.text)) return "suspended";
	if (NOT_FOUND_MESSAGE_PATTERN.test(state.text)) return "notFound";
	if (elapsedMs < MIN_CLEAR_WAIT_MS) return null;

	const relationshipStatus = classifyRelationship(relationship);
	if (relationshipStatus) return relationshipStatus;
	if (state.profileLoaded && !UNBLOCK_ACTION_PATTERN.test(state.text))
		return "clear";
	return null;
}
