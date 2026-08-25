// Fallback for a diff GitHub refuses to render.
//
// The unified-diff media type on the pull request, commit, and compare
// endpoints caps out: GitHub answers 406 with "Sorry, the diff exceeded the
// maximum number of lines (20000)". The JSON endpoints have no such cap. They
// return one entry per file, each carrying its own hunks in a `patch` field,
// so ghdiff stitches those entries back into a git-style patch.
//
// Two limits remain, and both are GitHub's:
//  - A pull request lists at most 3000 files; a commit or compare at most 300.
//  - A single file whose diff is very large arrives with no `patch` field.
// `synthesizePatch` reports both counts so the UI can say what is missing
// rather than showing a short diff as if it were whole.

export interface GitHubPullFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  previous_filename?: string;
  patch?: string;
}

export interface SynthesizedPatch {
  patch: string;
  fileCount: number;
  /** Files listed with no hunks, because GitHub judged the file diff too big. */
  filesWithoutPatch: string[];
}

const DEFAULT_MODE = '100644';

function headerLines(file: GitHubPullFile): string[] {
  const newPath = file.filename;
  const oldPath = file.previous_filename ?? file.filename;
  const lines = [`diff --git a/${oldPath} b/${newPath}`];

  switch (file.status) {
    case 'added':
      lines.push(`new file mode ${DEFAULT_MODE}`);
      lines.push('--- /dev/null', `+++ b/${newPath}`);
      break;
    case 'removed':
      lines.push(`deleted file mode ${DEFAULT_MODE}`);
      lines.push(`--- a/${oldPath}`, '+++ /dev/null');
      break;
    case 'renamed':
    case 'copied': {
      const verb = file.status === 'copied' ? 'copy' : 'rename';
      // A git-format rename is only recognizable by its `similarity index`
      // line: 100% means the content is untouched, anything else means the
      // rename also changed content. The JSON endpoint reports no percentage,
      // and only that one distinction is load-bearing, so a changed rename
      // carries the nearest value below 100.
      if (file.patch == null) {
        lines.push('similarity index 100%');
        lines.push(`${verb} from ${oldPath}`, `${verb} to ${newPath}`);
      } else {
        lines.push('similarity index 99%');
        lines.push(`${verb} from ${oldPath}`, `${verb} to ${newPath}`);
        lines.push(`--- a/${oldPath}`, `+++ b/${newPath}`);
      }
      break;
    }
    default:
      lines.push(`--- a/${oldPath}`, `+++ b/${newPath}`);
      break;
  }

  return lines;
}

/** Stitches per-file entries back into one git-style patch. */
export function synthesizePatch(
  files: readonly GitHubPullFile[]
): SynthesizedPatch {
  const blocks: string[] = [];
  const filesWithoutPatch: string[] = [];
  let fileCount = 0;

  for (const file of files) {
    if (file.filename.length === 0) continue;
    fileCount++;

    const lines = headerLines(file);
    if (file.patch != null && file.patch.length > 0) {
      // GitHub omits the trailing newline on `patch`.
      lines.push(file.patch.replace(/\n+$/, ''));
    } else if (file.status !== 'renamed' && file.status !== 'copied') {
      // No hunks and not a pure rename: the file diff was too big for GitHub
      // to include. It still belongs in the tree and in the counts.
      filesWithoutPatch.push(file.filename);
    }
    blocks.push(`${lines.join('\n')}\n`);
  }

  return { patch: blocks.join(''), fileCount, filesWithoutPatch };
}

/** One line the UI can show when the fallback could not carry everything. */
export function describeSynthesisGaps(
  result: SynthesizedPatch,
  truncatedFileList: boolean
): string | undefined {
  const notes: string[] = [];
  if (truncatedFileList) {
    notes.push(
      `GitHub lists at most ${result.fileCount} files for this diff, so later files are absent.`
    );
  }
  const missing = result.filesWithoutPatch.length;
  if (missing > 0) {
    notes.push(
      missing === 1
        ? `GitHub judged 1 file too large to diff, so it shows no lines: ${result.filesWithoutPatch[0]}.`
        : `GitHub judged ${missing} files too large to diff, so they show no lines.`
    );
  }
  return notes.length === 0 ? undefined : notes.join(' ');
}

// --- Fetching the file lists ------------------------------------------------

const PER_PAGE = 100;
/** GitHub lists at most 3000 files for a pull request. */
const MAX_PULL_PAGES = 30;
/** A commit or a compare range lists at most 300. */
const MAX_RANGE_PAGES = 3;

export interface FetchedFiles {
  files: GitHubPullFile[];
  /** True when GitHub had more files than it would list. */
  truncated: boolean;
}

interface PagedFetch {
  path: string;
  maxPages: number;
  /** Reads the file array out of one page of the response. */
  select(page: unknown): GitHubPullFile[];
}

async function fetchPaged(
  fetchJson: <T>(path: string) => Promise<T>,
  spec: PagedFetch
): Promise<FetchedFiles> {
  const files: GitHubPullFile[] = [];
  const separator = spec.path.includes('?') ? '&' : '?';

  for (let page = 1; page <= spec.maxPages; page++) {
    const body = await fetchJson<unknown>(
      `${spec.path}${separator}per_page=${PER_PAGE}&page=${page}`
    );
    const pageFiles = spec.select(body);
    files.push(...pageFiles);
    if (pageFiles.length < PER_PAGE) {
      return { files, truncated: false };
    }
  }
  // Every page came back full, so GitHub has more than it will list.
  return { files, truncated: true };
}

function asFileArray(value: unknown): GitHubPullFile[] {
  return Array.isArray(value) ? (value as GitHubPullFile[]) : [];
}

function asFilesField(value: unknown): GitHubPullFile[] {
  if (typeof value !== 'object' || value == null || !('files' in value)) {
    return [];
  }
  return asFileArray((value as { files: unknown }).files);
}

export function pullFilesFetch(
  owner: string,
  repo: string,
  number: number
): PagedFetch {
  return {
    path: `/repos/${owner}/${repo}/pulls/${number}/files`,
    maxPages: MAX_PULL_PAGES,
    select: asFileArray,
  };
}

export function commitFilesFetch(
  owner: string,
  repo: string,
  sha: string
): PagedFetch {
  return {
    path: `/repos/${owner}/${repo}/commits/${sha}`,
    maxPages: MAX_RANGE_PAGES,
    select: asFilesField,
  };
}

export function compareFilesFetch(
  owner: string,
  repo: string,
  base: string,
  head: string
): PagedFetch {
  return {
    path: `/repos/${owner}/${repo}/compare/${base}...${head}`,
    maxPages: MAX_RANGE_PAGES,
    select: asFilesField,
  };
}

export function fetchFilePages(
  fetchJson: <T>(path: string) => Promise<T>,
  spec: PagedFetch
): Promise<FetchedFiles> {
  return fetchPaged(fetchJson, spec);
}
