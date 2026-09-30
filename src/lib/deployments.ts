// The deployments GitHub has on record for the diff under review, and the one
// question a reviewer brings to them: which link shows this code running.
//
// GitHub's Deployments API is the only source read. It is where GitHub's own
// **View deployment** button reads from, and it is provider-neutral: Vercel,
// wrangler-action, and any workflow that calls `createDeployment` all land
// there. A provider that only posts a bot comment is not read — a parser per
// bot is a parser that breaks the day the bot rewords itself.

/**
 * A deployment's state, in the readings a reviewer acts on. GitHub has eight
 * status states and eleven deployment states; everything that means "not done
 * yet" is `pending`, and `error` is a failure with another name.
 *
 * `inactive` is a deployment a newer one in the same environment replaced.
 * It is not broken: a preview host keeps every build at its own address, so the
 * link usually still answers. `unknown` is a deployment that never reported a
 * status at all and is too old to still be on its way.
 */
export type DeploymentState =
  | 'pending'
  | 'success'
  | 'failure'
  | 'inactive'
  | 'unknown';

export interface Deployment {
  id: number;
  environment: string;
  description?: string;
  /** The full sha of the commit this deployment was built from. */
  sha: string;
  /**
   * The branch it was built from, when the provider named one. Cloudflare Pages
   * names the branch, and its branch alias is built from this.
   */
  branch?: string;
  createdAt: string;
  creatorLogin?: string;
  creatorAvatarUrl?: string;
  state: DeploymentState;
  /** Where the build answers. Only ever an http or https address. */
  url?: string;
  /** Where its log is. Only ever an http or https address. */
  logUrl?: string;
}

/** The head commit's check rollup, reduced to what decides whether to wait. */
export type HeadChecks = 'pending' | 'success' | 'failure';

export interface DeploymentsData {
  /** The full sha the target's head is at now, which can be newer than the diff. */
  headSha?: string;
  headChecks?: HeadChecks;
  /** Newest first. */
  deployments: Deployment[];
}

/**
 * What a deployment looks like before it is read: the fields both GitHub APIs
 * carry, in either spelling of the state. The server fills this in from REST or
 * from GraphQL and hands it to `toDeployment`.
 */
export interface DeploymentSource {
  id: number;
  environment?: string | null;
  description?: string | null;
  sha: string;
  branch?: string | null;
  createdAt: string;
  creatorLogin?: string | null;
  creatorAvatarUrl?: string | null;
  /** The deployment's own state. GraphQL only. */
  deploymentState?: string | null;
  /** The newest status's state, when there is a status. */
  statusState?: string | null;
  environmentUrl?: string | null;
  logUrl?: string | null;
}

/**
 * A deployment with no status for this long is not coming. Actions can create a
 * deployment and then be cancelled before it reports anything, and a record
 * like that would otherwise read as in progress forever.
 */
export const STALLED_AFTER_MS = 60 * 60 * 1000;

const PENDING_STATES = new Set(['pending', 'queued', 'in_progress', 'waiting']);

/**
 * The address a deployment gave, if it is one a link may carry.
 * `environment_url` is written by whoever can create a deployment, and a
 * `javascript:` address in an `href` runs as script in this origin.
 */
export function safeDeploymentUrl(
  value: string | null | undefined
): string | undefined {
  if (value == null || value.length === 0) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * One deployment as the menu reads it, or nothing for one the menu must not
 * offer: a destroyed or abandoned environment has no address left to open.
 */
export function toDeployment(
  source: DeploymentSource,
  now: number
): Deployment | undefined {
  const own = source.deploymentState?.toLowerCase();
  if (own === 'destroyed' || own === 'abandoned') return undefined;
  const status = source.statusState?.toLowerCase();
  let state = readState(status ?? own);
  if (
    state === 'pending' &&
    status == null &&
    now - Date.parse(source.createdAt) > STALLED_AFTER_MS
  ) {
    state = 'unknown';
  }
  return {
    id: source.id,
    environment: source.environment ?? 'default',
    description: source.description ?? undefined,
    sha: source.sha,
    branch: source.branch ?? undefined,
    createdAt: source.createdAt,
    creatorLogin: source.creatorLogin ?? undefined,
    creatorAvatarUrl: source.creatorAvatarUrl ?? undefined,
    state,
    url: safeDeploymentUrl(source.environmentUrl),
    logUrl: safeDeploymentUrl(source.logUrl),
  };
}

function readState(value: string | undefined): DeploymentState {
  // A deployment with no status yet is how every Actions workflow starts one.
  if (value == null) return 'pending';
  if (PENDING_STATES.has(value)) return 'pending';
  // `active` is GraphQL's name for the deployment that is live now.
  if (value === 'success' || value === 'active') return 'success';
  if (value === 'failure' || value === 'error') return 'failure';
  if (value === 'inactive') return 'inactive';
  return 'unknown';
}

/** The rollup's five states, reduced to whether the head is still being built. */
export function readHeadChecks(
  state: string | null | undefined
): HeadChecks | undefined {
  switch (state?.toUpperCase()) {
    case 'PENDING':
    case 'EXPECTED':
      return 'pending';
    case 'SUCCESS':
      return 'success';
    case 'FAILURE':
    case 'ERROR':
      return 'failure';
    default:
      return undefined;
  }
}

/** A deployment's host names what serves it, and so which mark it wears. */
export type DeploymentProvider =
  | 'cloudflare'
  | 'vercel'
  | 'netlify'
  | 'github'
  | 'other';

export function deploymentProvider(deployment: Deployment): {
  id: DeploymentProvider;
  label: string;
} {
  const host = hostOf(deployment.url) ?? '';
  if (host.endsWith('.pages.dev')) {
    return { id: 'cloudflare', label: 'Cloudflare Pages' };
  }
  if (host.endsWith('.workers.dev')) {
    return { id: 'cloudflare', label: 'Cloudflare Workers' };
  }
  if (host.endsWith('.vercel.app') || host.endsWith('.vercel.sh')) {
    return { id: 'vercel', label: 'Vercel' };
  }
  if (host.endsWith('.netlify.app')) return { id: 'netlify', label: 'Netlify' };
  // A workflow's own deployment says what it is in its description, and that
  // is a better name than the account that ran it — which for every workflow
  // is `github-actions`.
  const label =
    deployment.description?.trim() ||
    deployment.creatorLogin?.replace(/\[bot\]$/, '') ||
    deployment.environment;
  return { id: isActions(deployment.creatorLogin) ? 'github' : 'other', label };
}

/** GraphQL names the Actions app `github-actions`, and REST adds `[bot]`. */
function isActions(login: string | undefined): boolean {
  return login === 'github-actions' || login === 'github-actions[bot]';
}

function hostOf(url: string | undefined): string | undefined {
  if (url == null) return undefined;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

// Cloudflare Pages names every build by its own id, `<8 hex>.<project>.pages.dev`,
// and gives each branch a second name that follows its newest build.
const PAGES_BUILD_HOST = /^[0-9a-f]{8}\.([a-z0-9-]+\.pages\.dev)$/;
const PAGES_ALIAS_LENGTH = 28;

/**
 * The branch alias Cloudflare Pages gives a preview branch: the address that
 * always shows the branch's newest successful build.
 *
 * GitHub never sees it — wrangler-action records the build's own address — so
 * it is rebuilt from the branch name by Cloudflare's rule: lower case, every
 * character that is not a letter or a digit replaced by `-`, cut at 28, and no
 * `-` left at the end. Checked against four live aliases on troph-team/lilja,
 * one of them cut mid-word and one cut on a `-`.
 */
export function pagesBranchAlias(
  url: string | undefined,
  branch: string | undefined
): string | undefined {
  if (url == null || branch == null || branch.length === 0) return undefined;
  const host = hostOf(url);
  const project = host?.match(PAGES_BUILD_HOST)?.[1];
  if (project == null) return undefined;
  const label = branch
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .slice(0, PAGES_ALIAS_LENGTH)
    .replace(/-+$/, '');
  if (label.length === 0) return undefined;
  return `https://${label}.${project}/`;
}

/**
 * Where one environment stands against the head.
 *
 * - `current`: the head's own build succeeded.
 * - `building`: the head's own build is in progress.
 * - `failed`: the head's own build failed.
 * - `waiting`: the head has no build here yet, and its checks are still going.
 * - `outdated`: the head has no build here, and nothing is running that will
 *   make one. The link is the newest build there is.
 */
export type EnvironmentReading =
  | 'current'
  | 'building'
  | 'failed'
  | 'waiting'
  | 'outdated';

export interface EnvironmentLatest {
  environment: string;
  reading: EnvironmentReading;
  /** The newest deployment in this environment. */
  newest: Deployment;
  /** Where a press goes. Absent when nothing here has an address. */
  href?: string;
  /**
   * The build `href` opens, which is older than the head unless `current`.
   * Absent when nothing here has an address, and `href` is then the log.
   */
  shown?: Deployment;
}

/**
 * One row per environment for the top of the menu, in name order so a poll
 * that changes a state never moves a row under the pointer.
 */
export function latestByEnvironment(
  data: DeploymentsData
): EnvironmentLatest[] {
  const groups = new Map<string, Deployment[]>();
  for (const deployment of newestFirst(data.deployments)) {
    const group = groups.get(deployment.environment);
    if (group == null) groups.set(deployment.environment, [deployment]);
    else group.push(deployment);
  }

  const rows: EnvironmentLatest[] = [];
  for (const [environment, group] of groups) {
    const newest = group[0];
    if (newest == null) continue;
    const working = group.find(isViewable);
    const alias = pagesBranchAlias(working?.url, working?.branch);
    rows.push({
      environment,
      reading: readEnvironment(newest, data),
      newest,
      href: alias ?? working?.url ?? newest.logUrl,
      shown: working,
    });
  }
  return rows.sort((a, b) => a.environment.localeCompare(b.environment));
}

function readEnvironment(
  newest: Deployment,
  data: DeploymentsData
): EnvironmentReading {
  const { headSha, headChecks } = data;
  if (headSha == null || newest.sha === headSha) {
    switch (newest.state) {
      case 'pending':
        return 'building';
      case 'failure':
      case 'unknown':
        return 'failed';
      default:
        return 'current';
    }
  }
  return headChecks === 'pending' ? 'waiting' : 'outdated';
}

/** A build a press can still open. `inactive` is replaced, not gone. */
function isViewable(deployment: Deployment): boolean {
  return (
    deployment.url != null &&
    (deployment.state === 'success' || deployment.state === 'inactive')
  );
}

export function newestFirst(deployments: readonly Deployment[]): Deployment[] {
  return [...deployments].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
  );
}

/**
 * Whether the answer on screen is about to change. Two things are still
 * moving: a build of the head that has not finished, and a head whose checks
 * are running while an environment has no build of it — the build is usually
 * one of those checks, or waits on them.
 *
 * A pull request with no deployments at all is not polled. Most repositories
 * deploy nothing, and every one of them has checks that run.
 */
export function deploymentsInFlight(data: DeploymentsData): boolean {
  if (data.deployments.length === 0) return false;
  return latestByEnvironment(data).some(
    (row) => row.reading === 'building' || row.reading === 'waiting'
  );
}
