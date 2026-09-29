import { IconApproved, IconComment, IconX } from '@pierre/icons';

import type { StatusTone } from '@/lib/pullStatus';
import type { ReviewVerdict } from '@/lib/reviewDecision';

// How a verdict looks, wherever one is drawn: the header's button, and each
// row of the team's reviews in the dialog it opens. One map, so an approval is
// one glyph in one green in both.

export const VERDICT_ICON: Record<ReviewVerdict, typeof IconApproved> = {
  approved: IconApproved,
  changes: IconX,
  commented: IconComment,
};

/**
 * The verdict's colour, in the tokens the status square paints with, so the
 * green on this button and the green on the square in the left bar are one
 * colour saying one thing. `pending` never reaches here — a verdict is a
 * decision already made — and it is listed because the tone vocabulary is
 * shared with the check axis, which does have a running state.
 */
export const VERDICT_COLOR: Record<StatusTone, string> = {
  success: 'text-status-success',
  failure: 'text-status-failure',
  pending: 'text-status-pending',
  neutral: 'text-status-neutral',
};
