import type { PageState, Relationship, Status } from "./types";

export const MIN_CLEAR_WAIT_MS = 5_000;

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
	if (
		/ブロックされています|あなたをブロックしました|ブロックされているため|you(?:'|’)re blocked|blocked you|has blocked you/i.test(
			state.text,
		)
	)
		return relationship?.blocking === true ? "mutual" : "blocked";
	if (/アカウントは凍結|account (?:is|has been) suspended/i.test(state.text))
		return "suspended";
	if (
		/アカウントは存在しません|this account doesn(?:'|’)t exist/i.test(
			state.text,
		)
	)
		return "notFound";

	const relationshipStatus = classifyRelationship(relationship);
	if (relationshipStatus) return relationshipStatus;
	if (elapsedMs < MIN_CLEAR_WAIT_MS) return null;
	if (state.profileLoaded && !/ブロックを解除|unblock/i.test(state.text))
		return "clear";
	return null;
}
