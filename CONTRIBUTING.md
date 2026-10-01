# Contributing

## Getting set up

```bash
npm install
npm test          # builds, then runs the suite
```

Nothing in the suite needs a plug or a Matter network. What talks to a
device sits behind matter.js; everything else — the state machine, the
learning, phases, energy, the recordings, the HomeKit sensors against
HAP-NodeJS — takes time and readings as arguments, so it runs anywhere.

## Working against real plugs

Run the plugin as a child bridge on the machine that can reach the plugs, and
read the log. Every reading is recorded under `appliance-monitor/power/` in the
Homebridge storage folder, one file per day, and the Curve tab of the settings
page draws them. A recorded cycle is the best test there is for the learning:
the curves in `test/cycle.test.ts` are made up, a real machine is not.

## Releasing

Publishing runs from GitHub Actions using [npm trusted
publishing](https://docs.npmjs.com/trusted-publishers), so no npm token is
stored in the repository and there is none to rotate.

**One-time setup on npmjs.com**, under the package's *Settings → Trusted
publisher*:

| Field | Value |
|---|---|
| Publisher | GitHub Actions |
| Organization or user | `rummeyer` |
| Repository | `homebridge-appliance-monitor` |
| Workflow filename | `publish.yml` |

That page only exists once the package does, so the very first version has to
go up another way — `npm publish` from a logged-in checkout. Every release
after it runs from Actions.

**To release:**

1. Bump `version` in `package.json` and add a `CHANGELOG.md` entry.
2. Commit, then tag: `git tag v1.0.0 && git push --follow-tags`.
3. Create a GitHub release for that tag.

The workflow checks the tag against `package.json` before publishing — a
mistagged release would otherwise put the wrong version under the right name,
and that cannot be undone.
