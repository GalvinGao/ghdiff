import { atom, useAtom } from 'jotai';

// An approval inside a stack ends on another screen. Approve and next sends the
// verdict, then opens the next layer, and the review screen is keyed by target,
// so the screen that pressed it is gone before anything could say the verdict
// landed. This atom carries that one fact across the navigation, and the screen
// it was meant for takes it on mount. It is never stored: a reload is a new
// visit, and there is nothing to report on one.

export interface StackHandoff {
  /** The pull request that was approved. */
  approved: number;
  /** Whether the approval's link reached the clipboard. */
  linkCopied?: boolean;
  /** `reviewTargetKey` of the screen the approval opened. */
  on: string;
  /** Where that screen sits in the stack. */
  number: number;
  position: number;
  total: number;
}

const stackHandoffAtom = atom<StackHandoff | null>(null);

export function useStackHandoff() {
  return useAtom(stackHandoffAtom);
}
