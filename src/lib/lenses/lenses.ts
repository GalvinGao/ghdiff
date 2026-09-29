import type { FileDiffMetadata } from '@pierre/diffs';

import type { ReviewTarget } from '../reviewTarget.ts';
import {
  acceptLocalizationSettings,
  DEFAULT_LOCALIZATION_SETTINGS,
  type LocalizationSettings,
  resolveLocaleSources,
} from './localization/config.ts';
import {
  buildLocalizationModel,
  type LocalizationModel,
} from './localization/model.ts';

// A lens is a way to read one kind of file that a diff draws badly.
//
// It is not a plugin: every lens is written here, compiled in, and listed in
// `LENSES`. What makes it a lens is its shape. It claims some files of a diff,
// it turns the claimed files into a model of its own, and a panel above the
// diff draws that model instead of the files. A claimed file is taken out of
// the diff's scroll and left in the tree, because it is still part of the
// review; the panel is simply where it is read.
//
// A lens does nothing for a repository until that repository's settings let
// it, and the settings are per repository because the files are: a message
// catalogue in one monorepo is an ordinary JSON file in the next.

/** One changed file, as much of it as a lens reads. */
export interface LensFile {
  itemId: string;
  path: string;
  fileDiff: FileDiffMetadata;
}

export interface Lens<Settings, Model extends LensModel> {
  label: string;
  defaults: Settings;
  accept(value: unknown): Settings | undefined;
  build(files: readonly LensFile[], settings: Settings): Model;
}

/** What every lens model answers, whatever else it holds. */
export interface LensModel {
  claimedItemIds: ReadonlySet<string>;
}

/** Every lens and its settings, stated once. Add a lens here. */
export interface LensSettingsById {
  localization: LocalizationSettings;
}

export interface LensModelsById {
  localization: LocalizationModel;
}

export type LensId = keyof LensSettingsById;

export const LENSES: {
  [Id in LensId]: Lens<LensSettingsById[Id], LensModelsById[Id]>;
} = {
  localization: {
    label: 'Localizations',
    defaults: DEFAULT_LOCALIZATION_SETTINGS,
    accept: acceptLocalizationSettings,
    build: (files, settings) =>
      buildLocalizationModel(
        files,
        resolveLocaleSources(
          settings,
          files.map((file) => file.path)
        )
      ),
  },
};

const LENS_IDS = Object.keys(LENSES) as LensId[];

/** One repository's settings. A lens nobody has touched is absent. */
export type RepoLensSettings = Partial<LensSettingsById>;

/** Every repository's settings, by `repoLensKey`. */
export type RepoLensStore = Readonly<Record<string, RepoLensSettings>>;

export const EMPTY_REPO_LENS_STORE: RepoLensStore = {};

/**
 * The repository a target belongs to, as the store names it.
 *
 * Owner and name in lower case for GitHub, because GitHub treats both without
 * case. A local diff is keyed by its root, which is the one name the command
 * is sure of; two clones of one repository are two keys, and that is the cost
 * of asking nothing beyond what the command already knows.
 */
export function repoLensKey(target: ReviewTarget): string {
  if (target.kind === 'local-diff') return `local:${target.root}`;
  return `${target.owner}/${target.repo}`.toLowerCase();
}

export function lensSettings<Id extends LensId>(
  repo: RepoLensSettings | undefined,
  id: Id
): LensSettingsById[Id] {
  return (
    (repo?.[id] as LensSettingsById[Id] | undefined) ?? LENSES[id].defaults
  );
}

/** Reads the stored value back. A repository that fails is dropped alone. */
export function acceptRepoLensStore(value: unknown): RepoLensStore | undefined {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) {
    return undefined;
  }
  const store: Record<string, RepoLensSettings> = {};
  for (const [repo, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== 'object' || raw == null) continue;
    const settings: Record<string, unknown> = {};
    for (const id of LENS_IDS) {
      const accepted = LENSES[id].accept((raw as Record<string, unknown>)[id]);
      if (accepted != null) settings[id] = accepted;
    }
    store[repo] = settings as RepoLensSettings;
  }
  return store;
}

export interface AppliedLenses {
  models: LensModelsById;
  /** Every file some lens claimed, which the diff's scroll leaves out. */
  claimedItemIds: ReadonlySet<string>;
}

/**
 * Runs every lens over a diff. A file goes to the first lens that claims it,
 * in `LENSES` order, so two lenses can never both take it out of the diff.
 */
export function applyLenses(
  files: readonly LensFile[],
  repo: RepoLensSettings | undefined
): AppliedLenses {
  const claimedItemIds = new Set<string>();
  const models = {} as LensModelsById;
  for (const id of LENS_IDS) {
    const open = files.filter((file) => !claimedItemIds.has(file.itemId));
    const model = LENSES[id].build(open, lensSettings(repo, id));
    for (const itemId of model.claimedItemIds) claimedItemIds.add(itemId);
    models[id] = model;
  }
  return { models, claimedItemIds };
}
