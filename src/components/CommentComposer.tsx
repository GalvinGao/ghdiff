import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { CheckBox } from '@/components/ui/CheckBox';
import { Tooltip } from '@/components/ui/Tooltip';
import type { CommentStore } from '@/hooks/useReviewComments';
import type { DraftComment } from '@/lib/comments';
import { textDirection } from '@/lib/locale';
import { m } from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';

/**
 * What the composer's actions are for one target, decided in one place: the
 * solid primary action (and what Cmd or Ctrl with Enter does), whether the
 * outline stage action is offered, why it is unavailable when it is, and the
 * hint a browser-only comment carries.
 */
export interface ComposerActions {
  /** The solid button's label. */
  primaryLabel: string;
  /** True when the primary action stages into the draft review. */
  joinsDraft: boolean;
  /** True when the outline stage action is offered alongside the primary. */
  stageOffered: boolean;
  /** Why the stage control is unavailable, for its tooltip and aria-label. */
  stageDisabledReason?: string;
  /** The line under the textarea for a comment that stays in this browser. */
  localHint?: string;
}

/**
 * The composer's action matrix. A pull request posts to its forge: the solid action is **Comment**, or **Add review suggestion** once a
 * draft review exists to join — the way github.com's own composer works once a
 * review is pending — with the outline suggestion beside it before one does. A
 * commit or a compare range has no review thread on the forge: the comment is
 * saved in this browser, the primary action says so, and the suggestion is
 * unavailable with the reason.
 */
export function composerActions(input: {
  store: CommentStore;
  canStage: boolean;
  draftsExist: boolean;
  stageNeedsSignIn: boolean;
}): ComposerActions {
  const local = input.store === 'local';
  // A draft review already on this target takes every new comment into it,
  // so the one solid action is the suggestion.
  const joinsDraft = input.canStage && input.draftsExist;
  if (local) {
    return {
      primaryLabel: m.comment_composer_save_comment(),
      joinsDraft: false,
      stageOffered: false,
      stageDisabledReason: m.comment_composer_suggestions_need_a_pull_request(),
      localHint: m.comment_composer_saved_in_this_browser_open_a_pull_request(),
    };
  }
  return {
    primaryLabel: joinsDraft
      ? m.comment_composer_add_review_suggestion()
      : m.review_decision_comment(),
    joinsDraft,
    stageOffered: !joinsDraft && input.canStage,
    stageDisabledReason:
      !joinsDraft && input.stageNeedsSignIn
        ? m.comment_composer_sign_in_to_stage_a_comment()
        : undefined,
  };
}

interface CommentComposerProps {
  /** Whether the note can be filed as an issue instead. */
  canCreateIssue: boolean;
  /** True when a draft can go to the forge: a pull target, and a credential. */
  canStage: boolean;
  /** True once a draft review exists on this target, so the composer joins it. */
  draftsExist: boolean;
  /** True on a pull target with no credential: staging wants a sign-in first. */
  stageNeedsSignIn: boolean;
  /** Where a comment written here goes, which decides the actions offered. */
  store: CommentStore;
  itemId: string;
  metadata: DraftComment;
  onCancel(itemId: string, key: string): void;
  onSave(itemId: string, key: string, body: string, createIssue: boolean): void;
  onStage(itemId: string, key: string, body: string): void;
}

export function CommentComposer({
  canCreateIssue,
  canStage,
  draftsExist,
  stageNeedsSignIn,
  store,
  itemId,
  metadata,
  onCancel,
  onSave,
  onStage,
}: CommentComposerProps) {
  const [body, setBody] = useState(metadata.draftBody);
  // Off for every new composer. Most notes are comments, and an issue is a
  // thing other people see in another place, so it is asked for each time.
  const [asIssue, setAsIssue] = useState(false);
  const createIssue = canCreateIssue && asIssue;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const canSave = body.trim().length > 0;
  const actions = composerActions({
    store,
    canStage,
    draftsExist,
    stageNeedsSignIn,
  });
  // The solid button, and what Cmd or Ctrl with Enter does. A note filed as
  // an issue is never staged: the issue is the thing other people read, and
  // the `see #N` it leaves on the line posts the way a comment does.
  const onPrimary = (text: string) => {
    if (createIssue) onSave(itemId, metadata.key, text, true);
    else if (actions.joinsDraft) onStage(itemId, metadata.key, text);
    else onSave(itemId, metadata.key, text, false);
  };
  const lineLabel =
    metadata.range.start === metadata.range.end
      ? m.comment_line({ line: metadata.range.end })
      : m.comment_line_range({
          start: Math.min(metadata.range.start, metadata.range.end),
          end: Math.max(metadata.range.start, metadata.range.end),
        });

  return (
    <form
      dir={textDirection(getLocale())}
      // Capped to match the thread card, so writing a comment and reading one
      // happen at the same measure.
      className="border-accent/40 bg-raised m-2 max-w-[42rem] rounded-lg border p-3 font-sans shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave) onPrimary(body);
      }}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <p className="text-ink-faint text-xs">{lineLabel}</p>
        {canCreateIssue && (
          <Button
            aria-pressed={createIssue}
            // The button's height and padding are its hover box and not its
            // text, so both are given back: the row stays one line of text
            // tall, and the label ends on the textarea's own right edge.
            className="-my-1.5 -mr-2 ml-auto"
            onClick={() => {
              setAsIssue((current) => !current);
              textareaRef.current?.focus();
            }}
            size="sm"
            title={m.comment_composer_files_this_note_as_an_issue_with_the_lines()}
            variant="quiet"
          >
            <CheckBox checked={createIssue} />
            {m.comment_composer_create_issue()}
          </Button>
        )}
      </div>
      <textarea
        dir="auto"
        ref={textareaRef}
        value={body}
        rows={3}
        placeholder={
          createIssue
            ? m.comment_composer_what_should_the_issue_say()
            : m.comment_composer_leave_a_comment()
        }
        className="border-line bg-canvas text-ink placeholder:text-ink-faint focus-visible:border-accent w-full resize-y rounded-md border p-2 text-sm focus-visible:outline-none"
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel(itemId, metadata.key);
            return;
          }
          // Cmd or Ctrl with Enter submits, which matches GitHub.
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            if (canSave) onPrimary(body);
          }
        }}
      />
      {actions.localHint != null && (
        <p className="text-ink-faint mt-1.5 text-[11px]">{actions.localHint}</p>
      )}
      <div className="mt-2 flex items-center gap-2">
        <Button type="submit" variant="solid" size="sm" disabled={!canSave}>
          {createIssue
            ? m.comment_composer_create_issue()
            : actions.primaryLabel}
        </Button>
        {!createIssue && actions.stageOffered && (
          <Button
            variant="outline"
            size="sm"
            disabled={!canSave}
            onClick={() => {
              if (canSave) onStage(itemId, metadata.key, body);
            }}
          >
            {m.comment_composer_add_review_suggestion()}
          </Button>
        )}
        {!createIssue &&
          actions.stageDisabledReason != null && (
            // A draft is the reviewer's own and lives on the forge, so staging
            // wants a credential; a commit or a compare range has no review
            // thread at all. The Tooltip hovers on its own wrapper, which is
            // what makes it work on a disabled button: `buttonClass` sets
            // `disabled:pointer-events-none`, so the pointer lands on the span.
            <Tooltip label={actions.stageDisabledReason} side="top-end" wide>
              <Button
                aria-label={m.review_submit_dialog_label({
                  label: m.comment_composer_add_review_suggestion(),
                  tip: actions.stageDisabledReason,
                })}
                variant="outline"
                size="sm"
                disabled
              >
                {m.comment_composer_add_review_suggestion()}
              </Button>
            </Tooltip>
          )}
        <Button
          variant="quiet"
          size="sm"
          onClick={() => onCancel(itemId, metadata.key)}
        >
          {m.comment_composer_cancel()}
        </Button>
        <span className="text-ink-faint ml-auto text-[11px]">
          {m.comment_composer_cmd_or_ctrl_with_enter()}
        </span>
      </div>
    </form>
  );
}
