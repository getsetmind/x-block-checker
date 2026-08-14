import type { PageState, Relationship, Status } from "./types.js";

export const MIN_CLEAR_WAIT_MS = 5_000;

export function classify(
	state: PageState,
	relationship: Relationship | undefined,
	elapsedMs: number,
): Status | null {
	const hasBlockedMessage =
		/ブロックされています|あなたをブロックしました|ブロックされているため/.test(
			state.text,
		) || /you(?:'|’)re blocked|blocked you|has blocked you/i.test(state.text);
	if (hasBlockedMessage)
		return relationship?.blocking === true ? "mutual" : "blocked";
	if (/アカウントは凍結|account (?:is|has been) suspended/i.test(state.text))
		return "suspended";
	if (
		/アカウントは存在しません|this account doesn(?:'|’)t exist/i.test(
			state.text,
		)
	)
		return "notFound";
	if (elapsedMs < MIN_CLEAR_WAIT_MS) return null;
	if (relationship?.blockedBy === true && relationship.blocking === true)
		return "mutual";
	if (relationship?.blockedBy === true) return "blocked";
	if (relationship?.blockedBy === false && relationship.blocking === true)
		return "blocking";
	if (relationship?.blockedBy === false && relationship.blocking === false)
		return "clear";
	if (state.profileLoaded && !/ブロックを解除|unblock/i.test(state.text))
		return "clear";
	return null;
}
