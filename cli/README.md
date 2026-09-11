# ghdiff

Read a local git diff in the ghdiff review surface.

`ghdiff` reads the repository you run it in, starts a small server on
`127.0.0.1`, and opens the review surface in your browser against a diff that is
on your own machine — uncommitted work, what is staged, or a branch against its
base. Nothing is uploaded anywhere.

```bash
npx ghdiff              # or: npm install -g ghdiff
```

## What it shows

| Invocation             | What it shows                 | Behind it                 |
| ---------------------- | ----------------------------- | ------------------------- |
| `ghdiff`               | uncommitted work              | `git diff HEAD`           |
| `ghdiff --staged`      | what is about to be committed | `git diff --cached`       |
| `ghdiff main`          | the branch against its base   | `git diff main...HEAD`    |
| `ghdiff main..feature` | any two revisions             | `git diff main...feature` |

| Flag         | Effect                                 |
| ------------ | -------------------------------------- |
| `--port <n>` | Bind this port instead of 7171.        |
| `--no-open`  | Print the address and open no browser. |
| `--version`  | The command's own version.             |
| `--help`     | The table above, in the terminal.      |

The port is always 7171 unless you say otherwise, and that is worth knowing
before you change it: your browser files comments and settings under the address
they were made at, so a different port is a different set of notes. If 7171 is
busy the command takes a free port instead and says so.

The process stays up until Ctrl-C. That is not idleness: expanding the
unmodified lines around a hunk fetches a whole file, one per press, so the
server has to still be there after the browser has taken the patch.

Files you have not added yet are in the diff too, at the end of it, and the
command says how many. `git diff HEAD` cannot see one, so each is read on its
own with `git diff --no-index` — nothing is staged and nothing is written to
your repository. The display menu in the top right has a switch that takes them
back off.

## What you get

The same reviewer the hosted site has: split or unified, hunk expansion, syntax
highlighting in workers, the file tree with its stat columns, the preset path
filters and the path search, whitespace-only changes dimmed, cron expressions
described beside the code, and a URL fragment that names the file and the lines
so you can send someone a link — while the command is running.

Comments and the files you have marked read are kept in your browser, under a
key made from the repository's absolute path. They survive Ctrl-C — which is
what the fixed port above is for — and they go nowhere else on their own — the
comments tab has a button that copies the whole review as markdown, each note
under the lines it is about, to paste into a coding agent.

## What it does with your machine

- The socket binds `127.0.0.1`. There is no flag that offers any other address.
- Every request for the diff or a file must carry a token minted for this run,
  in a custom header. No CORS header is sent, and no preflight is answered, so
  another page in another tab cannot reach these routes at all.
- The `Host` of every such request must name the loopback address, which is what
  closes DNS rebinding.
- The repository and the range are fixed when the process starts. No request
  chooses what is read.
- The command reads. It never commits, never changes your index, and never
  checks anything out: your `.git` directory is left exactly as it was. Showing
  untracked files needs them staged, so that is done in a temporary index and
  object store outside the repository, removed when the request ends.

## Requirements

`git` on `PATH`, and Node 20.19 or newer. Untracked files need git 2.25 or
newer; on an older git the diff arrives without them.
