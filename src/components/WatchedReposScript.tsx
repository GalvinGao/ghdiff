import { WATCHED_REPOS_STORAGE_KEY } from '@/lib/storageKeys';

// Runs before the first paint so the left bar never appears and then leaves.
//
// `useWatchedRepos` reads browser storage after mount, which is one paint too
// late: the server sends the bar's markup on every page, the browser draws it
// against an empty watch list, and the reviewer sees a column that asks for a
// repository for as long as hydration takes. Then it goes. A bar that flashes
// and leaves is worse than either answer on its own.
//
// So the answer is settled here instead, on the document, and `globals.css`
// keeps the bar off the first paint when the watch list is empty. React reaches
// the same answer a moment later through `watched.hydrated` and takes the
// element out for good, and nothing moves when it does.
//
// Every reading that leaves `useWatchedRepos` with an empty list has to land on
// 'no' here, or the two disagree and the flash comes back the other way round:
// no key, a key holding something that is not an array, and storage that throws
// are all 'no'.
const SCRIPT = `
(function () {
  try {
    var raw = localStorage.getItem('${WATCHED_REPOS_STORAGE_KEY}');
    var list = raw == null ? null : JSON.parse(raw);
    var watching = Array.isArray(list) && list.length > 0;
    document.documentElement.dataset.watching = watching ? 'yes' : 'no';
  } catch (error) {
    document.documentElement.dataset.watching = 'no';
  }
})();
`;

export function WatchedReposScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
