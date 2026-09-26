const PER_PAGE = 100;

export async function fetchGitHubPages<Row, Body = Row[]>(
  fetchJson: <T>(path: string) => Promise<T>,
  spec: {
    path: string;
    maxPages: number;
    select(page: Body): Row[];
  }
): Promise<{ rows: Row[]; truncated: boolean }> {
  const rows: Row[] = [];
  const separator = spec.path.includes('?') ? '&' : '?';

  for (let page = 1; page <= spec.maxPages; page++) {
    const body = await fetchJson<Body>(
      `${spec.path}${separator}per_page=${PER_PAGE}&page=${page}`
    );
    const pageRows = spec.select(body);
    rows.push(...pageRows);
    if (pageRows.length < PER_PAGE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}
