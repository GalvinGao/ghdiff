import { createContext, useCallback, useContext, useState } from 'react';

export const CommentDraftContext = createContext<
  Map<string, string> | undefined
>(undefined);

/** Survives a virtualized card unmount and a switch to another commit. */
export function useCommentDraft(key: string, initial = '') {
  const drafts = useContext(CommentDraftContext);
  const [body, setBody] = useState(() => drafts?.get(key) ?? initial);
  const set = useCallback(
    (next: string) => {
      if (next.length === 0) drafts?.delete(key);
      else drafts?.set(key, next);
      setBody(next);
    },
    [drafts, key]
  );
  return [body, set] as const;
}
