# SmedCover from a terminal (`smedcover`)

English · [中文](README_CLI.zh-CN.md)

`smedcover`, SmedCover's command line, makes covers from a terminal or a script: one channel's cover into a file, every
channel at every size into a folder, a cover for each row of a CSV, or any call an agent could make. This page covers
installing it, every command and flag, what it prints, its exit codes, how a run goes with the app, scripting it, and
what to do when something goes wrong. The rest of the app: [README.md](README.md); agents over MCP:
[README_MCP.md](README_MCP.md); how it works inside: [ARCHITECTURE.md](ARCHITECTURE.md) (10.7 to 10.9).

- [What it is](#what-it-is)
- [Installing](#installing)
- [A first run](#a-first-run)
- [Commands](#commands)
- [Flags every command takes](#flags-every-command-takes)
- [What it prints](#what-it-prints)
- [Exit codes and error kinds](#exit-codes-and-error-kinds)
- [How a run goes](#how-a-run-goes)
- [Scripting](#scripting)
- [Troubleshooting](#troubleshooting)

## What it is

- It draws nothing itself. Each command is one or two calls of the tools agents use ([Tools](README_MCP.md#tools)),
  and SmedCover does the work, so a cover from the command line is the cover the window exports.
- When SmedCover is open, the command works in that window: you see each step, as you see an agent's, and a change is
  one step of undo there.
- When it is not, the command starts it for the run: without a window on macOS (no Dock icon either), on Windows and
  Linux with its window shown without taking the focus. It quits about 2 seconds after the last command that used it,
  saving what it has to first, so the commands of a script share one app. Open its window meanwhile and it is yours:
  it stays.
- It needs neither the *MCP endpoint* switch nor its token. Every SmedCover listens for the command line on a port of
  its own on 127.0.0.1, with a token of its own, and says where in `cli.json` in its data folder (on macOS and Linux
  readable by you alone). Settings → *Agents* does not count the command line's calls. Nothing leaves the computer.
- The command and the app are one version (`smedcover --version`); the command is about 1.6 MB, with nothing else to
  install.

## Installing

### Where it is

Every installer has it beside the app:

| System | The command |
|---|---|
| macOS | `SmedCover.app/Contents/MacOS/smedcover` |
| Windows | `smedcover.exe`, in the folder SmedCover is installed in |
| Linux | `/usr/bin/smedcover`, from the `.deb` and the `.rpm` |

### On the PATH

To have `smedcover` in a terminal: Settings → *Agents* → *Command line* → *Install*.

- **macOS**: a link `/usr/local/bin/smedcover` to the one in the app. The system asks for an administrator's password,
  unless you may write in `/usr/local/bin` (Homebrew leaves it so on an Intel Mac). The card says when that name is
  another copy's (an older app, or one you moved: *Use this copy* points it at this one) or something that is not
  SmedCover's, which it leaves alone. *Uninstall* removes the link, and only a link of SmedCover's. If you move the
  app, install again. Run from the disk image, or from where you downloaded it (the system then runs it from a
  temporary place), it installs nothing: move SmedCover to Applications first, open it from there, then install.
- **Windows**: `smedcover.exe` is copied into a folder of its own, `%LOCALAPPDATA%\com.cyven.smedcover\bin` (with a
  small `app-path` file naming the app, which the command starts), and that folder is added to your own PATH (your
  account's, not the system's). Terminals opened after have `smedcover`; one already open does not. Only the command
  is on the PATH, not the app's other programs. SmedCover makes the copy anew as it starts after an update.
  *Uninstall* takes the folder off the PATH and removes it; uninstalling SmedCover removes the folder too (the `.exe`
  installer; the entry left on the PATH then finds nothing).
- **Linux**: the `.deb` and the `.rpm` have put it on the PATH already. An AppImage's cannot be used from a terminal:
  install a package for it.

### From the source

```bash
cargo build --release -p smedcover-cli      # target/release/smedcover
```

A development build's command line is `target/debug/smedcover` (`cargo build -p smedcover-cli`, or a plain
`cargo build`), beside the app `npm run tauri dev` makes, `target/debug/smedcover-app`; its card in Settings says where
it is and installs nothing. `tauri build` puts the command into every installer itself
([Run and build from source](README.md#run-and-build-from-source)).

### Which app it starts

When no SmedCover runs on its data folder, the command starts the app the first of these gives:

1. the `SMEDCOVER_APP` environment variable, when it is set;
2. an `app-path` file beside the command (Windows' copy on the PATH has one);
3. `smedcover-app` beside the command (a link to the command followed: `/usr/local/bin/smedcover` finds the app it
   points into);
4. on macOS, when there is none beside it, `/Applications/SmedCover.app`.

An `SMEDCOVER_APP` or an `app-path` naming a file that is not there is not passed over: the command says *Could not find
the SmedCover app at …* (exit 3).

### Check it

```bash
smedcover --version        # smedcover 0.6.0
smedcover profiles         # starts SmedCover if it is not open, and lists your profiles
```

SmedCover must have been set up once: a first start's welcome is never shown in a window the command started, so a
SmedCover that has not been through it answers exit 3, *Open SmedCover once and finish setting it up*.

## A first run

```console
$ smedcover profiles
My brand  (id p1)  ← shown
  look: cinema, dark · export folder: /Users/me/Covers
  channels:
    1. VLOG  (id c1, code V, #ff3366)  ← shown
    2. Tutorials  (id c2, code T, #33aaff)
  sizes (✓ ticked in Export):
    1920x1080  YouTube 16:9  ✓  ← shown
    1080x1920  Shorts  ✓
    1080x1080  Square

$ smedcover render VLOG --size 16:9 -o cover.png
/Users/me/cover.png

$ smedcover export --channels all --sizes all --out covers
Writing 01-VLOG_Rainy Tokyo night walk_1080x1920.png (2 of 6).        ← progress, drawn over on one line
/Users/me/covers/01-VLOG_Rainy Tokyo night walk_1920x1080.png
/Users/me/covers/01-VLOG_Rainy Tokyo night walk_1080x1920.png
…
6 files written to /Users/me/covers
```

A channel is named by its id, its name, its code or its number from 1 (`VLOG`, `c1`, `V` and `1` are the same channel
above); a size by its pixels (`1920x1080`), its ratio (`16:9`) or its name. The profile marked *shown* is the one the
window shows, and the one a command works on unless `--profile` names another.

## Commands

| Command | What it does | Tool it calls | Changes a cover |
|---|---|---|---|
| [`profiles`](#profiles) | Lists the profiles, with their channels and sizes | `get_context` | no |
| [`render`](#render) | Writes one channel's cover at one size into a file | `export` (and `get_context`) | no |
| [`export`](#export) | Writes covers into a folder | `export` | no |
| [`batch`](#batch) | Makes and exports a cover for each row of a CSV | `batch_covers` | no |
| [`import`](#import) | Opens a project file in the app | `open_project` | yes |
| [`tools`](#tools) | Lists the tools | `tools/list` | no |
| [`call`](#call) | Calls any tool with arguments as JSON | any | as the tool does |

Every command's flags are checked before SmedCover is reached: a command that is not right (an unknown flag, a value
out of range, a file that is not there) is exit 2 and starts nothing. `smedcover <command> --help` lists a command's
flags.

`render`, `export` and `batch` also take:

| Flag | What it does |
|---|---|
| `--profile PROFILE` | The profile, by id or name (default: the one shown). Another than the one shown takes the window there, as an agent's call does, and it stays there. |
| `--format FORMAT` | `png`, `jpg` or `jpeg`, `webp` (default: the export settings'; JPEG at their quality) |
| `--scale N` | The resolution, 1 to 4 times the size's pixels (default: the export settings') |

### `profiles`

```bash
smedcover profiles
```

Each profile, with its look, its export folder, its channels (by number, name, id, code and colour) and its sizes
(each by its key, the one `--size-key` takes, with ✓ for those ticked in Export). The profile, channel and size the
window shows are marked `← shown`. `--json` prints the whole of `get_context`'s answer, with the export settings,
whether undo can go further and what this SmedCover can do (cut out, AI set up) besides.

### `render`

```bash
smedcover render CHANNEL -o FILE [--size SIZE | --size-key KEY] [--profile P] [--format F] [--scale N]
```

Writes one channel's cover at one size into `FILE`, replacing a file of that name, and prints its path.

| Flag | What it does |
|---|---|
| `CHANNEL` | The channel: its id, name, code or number from 1 |
| `-o`, `--output FILE` | The file to write. Its folder must be there. |
| `--size SIZE` | The size: its pixels (`1920x1080`), ratio (`16:9`) or name |
| `--size-key KEY` | The size by its key, as `smedcover profiles` lists it |

- Without a size: the one on the canvas, when the profile is the one shown; else the profile's first size ticked in
  Export, else its first. That takes a call more (`get_context`, then `export`).
- The format is `--format`'s, else the file's extension's (`.png`, `.jpg`, `.jpeg`, `.webp`), else the export
  settings'. `--format` and an extension that disagree (`--format png -o cover.jpg`) are refused.
- The export writes into a hidden folder of its own beside the file (`.smedcover-render-…`), and the cover is moved
  from there to `FILE`; the folder is removed after, a second Ctrl-C included. So the folder `FILE` goes into must be
  one you may write in (else exit 2, *Could not write into …*, found once SmedCover is reached).

### `export`

```bash
smedcover export [--channels LIST] [--sizes LIST] [--out DIR] [--profile P] [--format F] [--scale N]
```

Writes covers into a folder, as Export does, and prints each file's path, a line each; *n files written to DIR* goes
to the standard error after.

| Flag | What it does |
|---|---|
| `--channels LIST` | The channels, by id, name, code or number, comma-separated (200 at most), or `all` (default: the one shown) |
| `--sizes LIST` | The sizes, by pixels, ratio or name, comma-separated (80 at most), or `all` (default: those ticked in Export) |
| `--out DIR` | The folder, made if it is not there (default: the profile's export folder) |

- It never writes over a file: a name taken gets a number. Each file is named by the export's file name pattern
  ([Export](README.md#export)).
- A profile that has no export folder yet wants `--out`. The folder `--out` names is not kept for the profile.
- Exporting changes no cover. Stopped in the window (*Stop waiting* on the pill that shows while a call runs, offered
  after 20 seconds, or Esc), the command fails (exit 1, kind `failed`); the files written by then stay in the folder,
  but are not listed.

### `batch`

```bash
smedcover batch FILE.csv [--sizes LIST] [--out DIR] [--profile P] [--format F] [--scale N]
smedcover batch - < FILE.csv
```

Makes a cover for each row of a CSV and exports it, as [Batch export](README.md#batch-export) does, and prints each
file as `export` does.

```csv
channel,title,tag,subtitle
VLOG,"Rainy *Tokyo* night walk",EP.12,Shibuya to Shinjuku in the rain
Tutorials,"First line\nsecond line",,
```

- The columns are channel, title, tag, subtitle; the header row is optional. The channel may be its name, its code or
  its number (`1` or `01`), not its id; a row with none uses the one shown. A row naming a channel the profile does not
  have writes nothing at all (exit 1), and the message lists the profile's channels.
- `*asterisks*` mark the highlighted words and `\n` breaks a line in a title, as in the editor.
- Each cover starts from its channel's cover with the row's words; the covers in the window are not changed.
- `--sizes` defaults to every size of the profile (not only those ticked in Export); `--out`, as `export`'s.
- `-` reads the CSV from the standard input. The text must be UTF-8 (a byte-order mark is fine: Excel's *CSV UTF-8*),
  up to 1,000,000 characters: split a longer one.

### `import`

```bash
smedcover import FILE.smedcover.json [--as new|current]
```

Opens a project file ([Project files](README.md#project-files)) into its own profile, and the window goes to it. When
this computer does not have its profile, `--as new` (the default) imports it as a new profile, and `--as current` puts
it into the current one. Prints the profile and channel it opened in (*new* or *already here*), and any warning (a font
it could not find, say). Undo in the window brings back the cover it replaced.

### `tools`

```bash
smedcover tools            # each tool's name and what it does, a line each
smedcover tools --json     # each with its inputSchema, outputSchema and annotations
```

### `call`

```bash
smedcover call TOOL [JSON] [--save-images DIR]
```

Calls any tool with its arguments as one JSON object (none: `{}`; `-`: read from the standard input), and prints what it
answers: its text, JSON laid out over lines. The images it answers with (`render_preview`, `surprise`) are saved into
`--save-images DIR` (made if it is not there) as `TOOL-1.png`, `TOOL-2.png`…, never over a file; without it they are
only described (`[image 1: image/png, 812.4 KB; --save-images DIR saves it]`). A tool SmedCover does not have is exit 2.

```bash
smedcover call get_cover '{"channel": "VLOG"}'
smedcover call set_text '{"title": "Rainy *Tokyo* night walk", "tag": "EP.12"}'
smedcover call set_look '{"look": "cinema", "theme": "dark"}'
smedcover call render_preview '{"size": "16:9"}' --save-images previews
smedcover call surprise '{"count": 4}' --save-images hands
smedcover call pick_hand '{"hand": 2}'
smedcover call undo
```

Each tool and its arguments: [Tools](README_MCP.md#tools), or `smedcover tools --json`. A call that changes the cover is
one step of undo in the window, as an agent's is.

## Flags every command takes

They go before or after the command (`smedcover --json profiles`, `smedcover profiles --json`).

| Flag | What it does |
|---|---|
| `--json` | Prints the result as one JSON document ([below](#--json)) |
| `-q`, `--quiet` | Prints no progress and no notes; the results and errors still |
| `--timeout SECS` | Gives up on each call after that long ([How a run goes](#timeouts)) |
| `--data DIR` | Works on another data folder than the app's own; the app started for the command is given it too |
| `-V`, `--version` | Prints the version |
| `-h`, `--help` | Prints the help (`smedcover <command> --help`: a command's) |

| Environment variable | What it does |
|---|---|
| `SMEDCOVER_DATA` | The data folder, as `--data` (which wins over it) |
| `SMEDCOVER_APP` | The app to start when none runs ([Which app it starts](#which-app-it-starts)) |
| `SMEDCOVER_SELFTEST` | A self-test's folder (development): its `data/` is the data folder, before `--data` |
| `LC_ALL`, `LC_MESSAGES`, `LANG` | The language, when neither SmedCover nor the system says one ([below](#text)) |

Paths may start with `~`, and a relative one is taken from the folder the command runs in: SmedCover is handed the
whole path.

## What it prints

### Text

- Results go to the standard output: a path a line for `render`, `export` and `batch`, short and plain for the others.
  A file's name holds its title, spaces and all (the default pattern is `{n}-{channel}_{title}_{size}`): read the
  lines whole (`while IFS= read -r file`), or take the paths from `--json`.
- Progress (*Writing … (3 of 12)*) goes to the standard error: one line drawn over in a terminal, a line each time it
  changes when the standard error is a file or a pipe. So do notes (*Starting SmedCover…*, *6 files written to …*, a
  version that differs from the app's) and errors, as `smedcover: <why>`. `--quiet` leaves the progress and the notes
  out, never an error.
- The command speaks the language set in SmedCover, else the system's: Chinese or English. What SmedCover answers (a
  tool's error, its progress) is in its own words. `--help` is in English.

### `--json`

One JSON document on the standard output, whatever happens, for a program to read:

| Command | What `--json` prints |
|---|---|
| `profiles` | `get_context`'s answer: `{"profiles": [{id, name, look, theme, channels, sizes, exportDir}], "current": {profile, channel, size, …}, "export", "history", "can", "app"}` |
| `render` | `{"path", "channel", "size", "title"}` |
| `export`, `batch` | `{"dir", "files": [{"path", "channel", "title", "size"}]}`, and `"cancelled": true` for one cut short |
| `import` | `{"profile": {"id", "name", "created"}, "channel", "warnings"}` |
| `tools` | The list of tools, each `{"name", "description", "inputSchema", "outputSchema", "annotations", …}` |
| `call` | The tool's whole result, `{"content": […], "structuredContent": …}`; an image saved has `"saved": PATH` for its data |

The shapes are each tool's `outputSchema` (`smedcover tools --json`). A failure prints

```json
{
  "error": {
    "kind": "busy",
    "message": "SmedCover is busy: …",
    "exit": 1
  }
}
```

and an export SmedCover answers was cut short (`"cancelled": true`) prints its result, the files written so far, with
that `"error"` in it. The one exception: a command line the command cannot read at all (an unknown flag, a missing
argument) prints only its usage message, on the standard error, with exit 2.

## Exit codes and error kinds

| Exit code | Meaning |
|---|---|
| 0 | Done |
| 1 | SmedCover answered an error: an unknown channel, a busy window, an export that failed or was stopped part-way… |
| 2 | The command was not right: an unknown command or flag, a value it does not take, a file that is not there — found before SmedCover is reached, so nothing is started (a folder `--out` names is made first, though); or a tool SmedCover does not have (`call`) |
| 3 | SmedCover could not be reached or started, or needs setting up first: open it once and finish the welcome |
| 4 | No answer in time: `--timeout`, or SmedCover's own wait for the tool; the call was cancelled |
| 130 | Interrupted (Ctrl-C) |

`--json`'s `error.kind` says which, for a script to test rather than the message:

| Kind | Exit | Meaning |
|---|---|---|
| `usage` | 2 | The command was not right |
| `invalid_arguments` | 1 | SmedCover refused an argument: no such channel, profile or size |
| `busy` | 1 | You were in the middle of something in the window (a dialog, typing, a drag) for as long as the call waits |
| `not_allowed`, `unavailable` | 1 | Not possible here, or not now: no cut-out engine ready, an effect this SmedCover cannot draw |
| `failed`, `malformed`, `rpc` | 1 | The work failed (the message says why), you stopped waiting for it in the window, the window went quiet past the tool's wait, or its answer could not be used |
| `cancelled` | 1 | An export cut short, the files written so far in the result |
| `too_many` | 1 | 16 calls already in hand, agents' included |
| `no_app`, `quit`, `no_data_folder` | 3 | No app to start, it quit before it was ready, or this computer has no data folder for it |
| `not_ready`, `unreachable`, `gone` | 3 | SmedCover was not ready in time, could not be reached, or went away during the call |
| `needs_setup` | 3 | SmedCover waits on its first start's welcome |
| `timeout` | 4 | No answer in time |
| `interrupted` | 130 | Ctrl-C |

## How a run goes

### With SmedCover open

The command finds the app running on its data folder and works in its window: you see each change as it is made, the
window goes to the profile `--profile` names, and *Undo* takes back a change of `import` or `call`. While you are in
the middle of something there (a dialog, typing, a drag, the colour picker), a call waits for you: 30 seconds for a
change, 10 for a read, then it is answered `busy` (exit 1). A command and an agent can work at once; their calls take
turns.

### With SmedCover closed

The command starts it (*Starting SmedCover…*) and waits up to 30 seconds for it to be ready. Done, it tells the app,
which quits about 2 seconds after the last command that used it, saving what it has to first: commands run one after
another share that one app, with no start between them. Bring its window up meanwhile (open SmedCover from the Finder,
the Dock or the Start menu, or click its window on Windows and Linux) and it is yours: it stays when the commands are
done, and your agents can reach it again. Until then they cannot: the endpoint for agents is not started in an app the
command started.

A script that reads the command's output (`$(smedcover …)`, `| jq`) waits for the command only, never for the app it
started.

### Timeouts

Without `--timeout`, a call is waited for as long as SmedCover keeps working on it: as long as SmedCover itself waits
for the tool ([Timeouts](README_MCP.md#timeouts-progress-and-cancelling)), and 10 seconds more, from its last word of
progress; never more than two hours in all.

| Command | Waits, from the last word of progress |
|---|---|
| `profiles` | 30 s |
| `tools` | 30 s, whatever `--timeout` says |
| `import` | 1 min |
| `render`, `export`, `batch` | 30 min (an export says how it gets on file by file) |
| `call` | The tool's own: 30 s for a read, 1 min for a change, 2 min for `render_preview` and `surprise`, 10 min for `cut_out`, 30 min for `export` and `batch_covers` |

`--timeout SECS` is the most each call may take in all (`render` without a size makes two calls). Past it the call is
cancelled, exit 4; what it changed so far stays, as one step of undo.

### Ctrl-C

- Before SmedCover is reached (the command checking its flags, reading a CSV from the standard input), Ctrl-C ends the
  command at once.
- After, it cancels the call under way: an export stops between two files, what a call changed so far stays (one step
  of undo), and an app started for the command is let go; then the command exits, 130. A second Ctrl-C ends it at once.
- The app started for the command does not get the terminal's Ctrl-C itself: it quits as described above.

### When the app goes away

When SmedCover cannot be reached before anything that changes something was sent (it was quitting just then, say),
the command reaches it, or a new one, once more. Once a change is on its way it never tries again, nor for a call cut
off while SmedCover worked on it: it fails (`unreachable` or `gone`, exit 3), and a change may or may not be done; look
at the window, or `smedcover call get_cover`, before going on.

## Scripting

```bash
# every channel at every size, the paths into a list
smedcover --json --quiet export --channels all --sizes all --out covers | jq -r '.files[].path' > covers.txt

# a cover per episode, from another program's CSV
./episodes-to-csv | smedcover batch - --sizes 16:9,9:16 --out covers

# the words, a look at it, then the file
smedcover call set_text '{"channel": "VLOG", "title": "Rainy *Tokyo* night walk", "tag": "EP.12"}'
smedcover call render_preview '{"channel": "VLOG", "size": "16:9"}' --save-images previews
smedcover render VLOG --size 16:9 -o ep12.png

# a busy window tried again; any other failure ends it
for attempt in 1 2 3; do
  if result=$(smedcover --json --quiet render VLOG -o cover.png); then break; fi
  [ "$(jq -r '.error.kind' <<<"$result")" = busy ] || exit 1
  sleep 10
done
```

- `set -e` and `&&` work as they should: every failure is a non-zero exit.
- To test what went wrong, test `error.kind` with `--json`, or the exit code; not the message, which is in the user's
  language.
- Run in CI or on a machine where SmedCover has never been opened, the command answers `needs_setup` (exit 3): set it up
  once, or point `--data` at a data folder copied from one that is.
- On Windows, PowerShell may take the quotes out of a JSON argument; give it on the standard input instead:

  ```powershell
  '{"title": "Rainy *Tokyo* night walk"}' | smedcover call set_text -
  ```

## Troubleshooting

| What you see | Why, and what to do |
|---|---|
| `smedcover: command not found` | It is not on the PATH: Settings → *Agents* → *Command line* → *Install*. On Windows, open a new terminal after installing. On Linux, an AppImage's cannot be used: install the `.deb` or the `.rpm`. |
| `Could not find the SmedCover app at …` | The command is not beside its app (moved, or copied elsewhere). Install it again from Settings, or set `SMEDCOVER_APP` to the app's executable (`…/SmedCover.app/Contents/MacOS/smedcover-app` on macOS). |
| `Open SmedCover once and finish setting it up, then try again.` | SmedCover has no profile yet. Open it and finish the welcome. |
| `SmedCover was not ready within 30 seconds` | It started but did not get ready. In parentheses, when there is one, why its `cli.json` was not taken (one others may read, or not yours: check the data folder's owner). To see what the app says, make a folder `logs` in the data folder ([where](README.md#where-your-data-lives)): an app started for the command writes its output to `logs/cli-app.log` there. |
| `SmedCover quit before it was ready` | It could not start: run it from the Finder or the Start menu to see why, or read `logs/cli-app.log` (above). |
| `SmedCover is busy: …` (exit 1) | You were in the middle of something in the window (the message says what) for as long as the call waits. Finish it and run the command again. |
| `SmedCover did not answer in time, so the call was given up; …` (exit 4), `… did not finish: nothing was heard from it for … s …` (exit 1), `No word from SmedCover for … s` (exit 4) | The call went quiet past its tool's wait: SmedCover's own, or the command's, 10 seconds longer. On Windows, a minimised window is slowed down: keep it on screen. What it changed so far stays: look at the window before going on. |
| `No answer within --timeout … s` (exit 4) | Give a longer `--timeout`, or none. |
| `--format png does not match the file's extension` | `render` takes the format from `-o`'s extension: drop `--format`, or make the two agree. |
| `… is not UTF-8 text` | Save the CSV as *CSV UTF-8* (Excel: Save As → CSV UTF-8; Numbers: Export To → CSV, Unicode UTF-8). |
| `No profile "…"` | `--profile` takes an id or a name, as `smedcover profiles` lists them. |
| `The profile "…" has no export folder yet: pass dir …` (exit 1) | Give `--out`, or choose the profile's folder in Export once. |
| `The user stopped waiting for … after … s; the window is theirs again.` (exit 1) | *Stop waiting* (or Esc) was pressed in the window. An export's files written by then stay in its folder. |
| `The export was stopped part-way.` (exit 1) | SmedCover cut the export short. The files written so far are printed. |
| `Note: SmedCover 0.6.1 is running; this command line is 0.6.0.` | The command on the PATH is another copy's. On macOS, *Use this copy* in Settings → *Agents* → *Command line*; on Windows, open SmedCover once after the update. |
| `SmedCover went away before it answered` (exit 3) | The app quit or was closed during the call. The change may or may not be done: look at the window before running it again. |
| `Note: SMEDCOVER_SELFTEST names the data folder …` | A self-test's folder is set in this terminal: `unset SMEDCOVER_SELFTEST` to use `--data`. |
