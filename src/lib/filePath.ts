// The rule for a path this app will look a file up by, in one place because two
// hosts apply it: the Worker's `/api/file` puts one into a URL, and the `ghdiff`
// command hands one to `git`. Neither can import the other.

/**
 * The rule is git's own, because the file comes back from git or from GitHub
 * and anything stricter refuses one they would both serve. A tree entry may
 * hold any byte but NUL, so a tab or a newline in a filename is legal — the
 * untracked list is read with `-z` for that very reason.
 *
 * NUL is refused because it ends a C string and is what `-z` separates on. A
 * segment of `.`, `..` or nothing is refused because that is what a path climbs
 * out of a repository with: `encodeRefForPath` escapes a segment but leaves a
 * dot alone, and git would resolve one against the working directory. Git
 * records no such component in a tree, so nothing servable is lost.
 */
export function isReadablePath(path: string): boolean {
  if (path.length === 0 || path.length > 1024) return false;
  if (path.includes('\0')) return false;
  return path
    .split('/')
    .every(
      (segment) => segment.length > 0 && segment !== '.' && segment !== '..'
    );
}
