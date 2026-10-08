# Domain Docs

How engineering skills consume this repo's domain documentation. This repo uses a single-context layout.

## Before exploring

- Read `GLOSSARY.md` at the repo root when it exists.
- Read decisions under `docs/adr/` that concern the area being explored.
- If either is absent, proceed silently. The `/domain-modeling` skill creates these documents when terms or decisions are resolved.

## File structure

```text
/
├── GLOSSARY.md
├── docs/adr/
│   └── 0001-<decision-name>.md
├── agent/
└── src/
```

## Use the glossary's vocabulary

Use terms defined in `GLOSSARY.md` in issue titles, proposals, hypotheses, and test names. If a concept has no entry, reconsider whether it belongs to the project's language; record real gaps for `/domain-modeling`.

## Flag ADR conflicts

When a proposal contradicts an existing ADR, identify the ADR and explain why the decision should be reopened.
