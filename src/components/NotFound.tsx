import { IconCiWarningFill } from '@pierre/icons';
import { Link } from '@tanstack/react-router';

import { m } from '../paraglide/messages.js';
import { buttonClass } from '@/components/ui/buttonClass';

export function NotFound() {
  return (
    <main className="bg-surface flex flex-1 items-center justify-center p-8">
      <div className="max-w-md text-center">
        <IconCiWarningFill
          aria-hidden="true"
          className="text-ink-faint mx-auto mb-3"
          size={20}
        />
        <h1 className="text-ink text-sm font-medium">
          {m.not_found_ghdiff_cannot_read_that_url()}
        </h1>
        <p className="text-ink-muted mt-1 text-sm text-pretty">
          {m.not_found_a_review_needs_a_github_pull_request_a()}
        </p>
        <Link className={buttonClass({ className: 'mt-4' })} to="/">
          {m.not_found_open_a_different_review()}
        </Link>
      </div>
    </main>
  );
}
