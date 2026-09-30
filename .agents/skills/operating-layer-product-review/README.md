# Operating Layer product review

Repository-local product management skill for Codex-compatible skill discovery. All content is original and specific to Operating Layer; no external skill bodies or scripts are vendored.

## Use
From an Ordermate checkout containing this directory, start a new Codex session if the skill menu has already loaded, then invoke:

```text
$operating-layer-product-review Reconcile current main with the roadmap and recommend the next delivery slice.
```

Other requests: assess an idea, review priorities against available capacity, prepare a delivery brief, or evaluate product release readiness.

If native discovery is unavailable, ask the agent to read `.agents/skills/operating-layer-product-review/SKILL.md` and follow it. This supports reading the workflow; it does not claim native installation.

## Files and dependencies
`SKILL.md` and both `references/` files are required. This README is usage documentation. The skill needs repository reading access; GitHub, analytics, customer research and current web sources improve evidence when available. It has no scripts, dependencies to install or production permissions.

The repository is the canonical skill source. A ChatGPT Project can use the instructions and references as context, but uploading them does not establish native skill execution or automatic sync. Adding this directory does not install a private ChatGPT plugin.

Do not ignore project-specific skill files when later bootstrapping shared Engineering Workflow dependencies. Refresh the historical context checkpoint when appropriate; keep goals, capacity and product state in designated product records rather than embedding a second live roadmap here.
