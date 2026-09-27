/**
 * The owner's decision on a creative. One vocabulary everywhere:
 * 'pending' | 'approved' | 'rejected'.
 *
 * The UI and the agent wrote 'approved'/'rejected' while publishing only
 * accepted 'verified', so an approved creative could never be published.
 * 'verified'/'not_verified' are still read as legacy spellings.
 */
export type ReviewDecision = 'pending' | 'approved' | 'rejected'

export function normalizeReview(status: string | null | undefined): ReviewDecision {
  if (status === 'approved' || status === 'verified') return 'approved'
  if (status === 'rejected' || status === 'not_verified') return 'rejected'
  return 'pending'
}

export const isApproved = (status: string | null | undefined) => normalizeReview(status) === 'approved'
