import { IconCiWarningFill } from '@pierre/icons';
import { Link } from '@tanstack/react-router';

import { useAppData } from '@/components/AppDataProvider';
import { buttonClass } from '@/components/ui/buttonClass';
import { servesSentenceFor } from '@/lib/forges';
import { m } from '@/paraglide/messages.js';

export function NotFound() {
  const { instance } = useAppData();
  // The instance answer arrives with the page, so this sentence is true from
  // the first paint — the same one the forge gate's 404 carries.
  const serves = servesSentenceFor(instance);
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
          {serves} {m.not_found_a_review_needs_a_github_pull_request_a()}
        </p>
        <Link className={buttonClass({ className: 'mt-4' })} to="/">
          {m.not_found_open_a_different_review()}
        </Link>
      </div>
    </main>
  );
}
