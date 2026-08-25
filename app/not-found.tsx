import { IconCiWarningFill } from '@pierre/icons';
import Link from 'next/link';

import { buttonClass } from '@/components/ui/buttonClass';

export default function NotFound() {
  return (
    <main className="bg-surface flex flex-1 items-center justify-center p-8">
      <div className="max-w-md text-center">
        <IconCiWarningFill
          aria-hidden="true"
          className="text-ink-faint mx-auto mb-3"
          size={20}
        />
        <h1 className="text-ink text-sm font-medium">
          Reviewer cannot read that address
        </h1>
        <p className="text-ink-muted mt-1 text-sm text-pretty">
          A review needs a GitHub pull request, a commit, or a compare range.
        </p>
        <Link className={buttonClass({ className: 'mt-4' })} href="/">
          Open a different review
        </Link>
      </div>
    </main>
  );
}
