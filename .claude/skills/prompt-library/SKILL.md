---
name: prompt-library
description: Search and retrieve ready-made AI prompt templates ("act as...") from the prompts.chat community library (formerly Awesome ChatGPT Prompts, 2000+ prompts). Use when the user wants a prompt template, asks "is there a prompt for X", wants to browse or improve act-as prompts, or mentions prompts.chat / awesome-chatgpt-prompts.
---

# Prompt Library (prompts.chat)

Offline, self-contained access to the [prompts.chat](https://prompts.chat)
dataset (2169 curated prompts, formerly "Awesome ChatGPT Prompts"). The
whole dataset is bundled locally in `references/prompts.csv`, so this
works without network access or any API key.

## When to activate

- The user asks for a prompt template ("dame un prompt para revisar código",
  "find me a prompt for X", "act as a ... prompt").
- The user wants to browse or discover prompts for a task or role.
- The user mentions prompts.chat or awesome-chatgpt-prompts.
- The user wants help improving/adapting an existing prompt from the library.

## Dataset

File: `references/prompts.csv` — CSV with columns:

- `act` — the prompt's title / persona (e.g. "Linux Terminal").
- `prompt` — the full prompt text. May contain `${variable}` or
  `${variable:default}` placeholders the user needs to fill in.
- `for_devs` — `TRUE`/`FALSE`, whether it's aimed at developers.
- `type` — `TEXT`, `STRUCTURED`, or `IMAGE`.
- `contributor` — GitHub handle of whoever contributed it.

Some `prompt` fields contain embedded newlines (quoted CSV), so search
with a CSV-aware method, not plain line-based grep.

## How to search

Run a small Python snippet (the field can exceed the default CSV field
size limit, hence `csv.field_size_limit`):

```bash
python3 - <<'PY'
import csv, sys
csv.field_size_limit(sys.maxsize)
query = "code review"   # replace with the user's keywords, lowercase match
path = ".claude/skills/prompt-library/references/prompts.csv"
with open(path, newline="", encoding="utf-8") as f:
    for row in csv.DictReader(f):
        haystack = (row["act"] + " " + row["prompt"]).lower()
        if query.lower() in haystack:
            print(f"### {row['act']}  [{row['type']}, for_devs={row['for_devs']}, by {row['contributor']}]")
            print(row["prompt"])
            print()
PY
```

Adjust `query` to match on multiple keywords (e.g. check that all of a
list of terms appear), and cap the number of results shown (e.g. break
after 5-10 matches) so the reply stays readable.

## Presenting results

For each matching prompt, show:

- The title (`act`) as a heading.
- Whether it's a developer prompt and its type.
- The full prompt text in a code block, ready to copy.

If the prompt contains `${variable}` or `${variable:default}` placeholders,
point them out and ask the user for values (or use the defaults) before
handing over the final, filled-in prompt.

## Updating the dataset

The bundled CSV is a point-in-time copy. If the user wants the very latest
prompts, fetch the current file from
`https://raw.githubusercontent.com/f/prompts.chat/main/prompts.csv` and
mention that the local copy may be a bit behind.

## Attribution & license

Data from [f/prompts.chat](https://github.com/f/prompts.chat) by Fatih
Kadir Akın and contributors. The prompt data (`prompts.csv`) is dedicated
to the public domain under CC0 1.0 Universal — free to reuse, no
attribution legally required, but crediting the project is good practice.
