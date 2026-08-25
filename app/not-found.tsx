import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-md text-center">
        <h1 className="text-ink text-lg font-semibold">
          Reviewer cannot read that address.
        </h1>
        <p className="text-ink-muted mt-2 text-sm">
          A GitHub review needs a pull request, a commit, or a compare range. A
          local review needs a repository path and a base ref.
        </p>
        <Link
          href="/"
          className="text-accent mt-4 inline-block text-sm underline"
        >
          Open a different review
        </Link>
      </div>
    </main>
  );
}
