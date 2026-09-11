import type { ReactNode } from 'react';
import { useMemo } from 'react';

import {
  type AppData,
  AppDataContext,
} from '../../src/components/AppDataProvider';
import { useCodeFont } from '../../src/hooks/useCodeFont';
import { useColorMode } from '../../src/hooks/useColorMode';

// What `AppDataProvider` is on a machine with no GitHub in the picture.
//
// The hosted provider mounts five hooks. Two of them are settings — the colour
// mode and the code font — and they are mounted here unchanged, because a
// reviewer's scheme and typeface are the same choice wherever the diff came
// from, stored under the same keys and shared with every other ghdiff tab.
//
// The other three are questions for GitHub: who is signed in, which
// repositories are watched, and what is open in them. None of them has an
// answer here, and this is the honest way to say so. The alternative was a
// local server that answered `viewer.get` with an empty viewer — which is the
// same shape but a worse arrangement, because it means every one of those hooks
// issues a request to a server that exists only to say "nobody" back.
//
// So the three are supplied inert, and the screen reads them the way it already
// reads a signed-out session. `hydrated: true` with an empty watch list is the
// state `PullRail` and `PullListButton` already answer by drawing nothing, and
// `ReviewScreen` already turns its `showBrand` on for it.

const NO_SESSION: AppData['session'] = {
  signedIn: false,
  canSignOut: false,
  checking: false,
  signIn: () => {},
  signOut: () => {},
};

const NO_PULLS: AppData['pulls'] = {
  loading: false,
  reload: () => {},
};

const NO_WATCH_LIST: AppData['watched'] = {
  repos: [],
  hydrated: true,
  add: () => false,
  remove: () => {},
};

export function LocalAppData({ children }: { children: ReactNode }) {
  const codeFont = useCodeFont();
  const colorMode = useColorMode();

  const value = useMemo<AppData>(
    () => ({
      codeFont,
      colorMode,
      pulls: NO_PULLS,
      session: NO_SESSION,
      watched: NO_WATCH_LIST,
    }),
    [codeFont, colorMode]
  );

  return (
    <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
  );
}
