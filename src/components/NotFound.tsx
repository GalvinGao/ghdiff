import { IconCiWarningFill } from '@pierre/icons';
import { Link } from '@tanstack/react-router';

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
          ghdiff cannot read that URL
        </h1>
        <p className="text-ink-muted mt-1 text-sm text-pretty">
          A review needs a GitHub pull request, a commit, or a compare range.
        </p>
        <Link className={buttonClass({ className: 'mt-4' })} to="/">
          Open a different review
        </Link>
      </div>
    </main>
  );
}
