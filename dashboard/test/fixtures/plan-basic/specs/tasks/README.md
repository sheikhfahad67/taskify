# Fixture Plan Task Specs

## Waves and dependency graph

```
Wave 1   T1.01 → T1.02
Wave 2   T2.01 ∥ T2.02
```

## Task index

| ID | Phase | Title | Status | Review | Depends on |
|---|---|---|---|---|---|
| T1.01 | 1 | Alpha does the first thing | done | approved | — |
| T1.02 | 1 | Beta does the second thing | in_review | pending | T1.01 |
| T2.01 | 2 | Gamma does the third thing | changes_requested | changes_requested | T1.02 |
| T2.02 | 2 | Delta does the fourth thing | pending | pending | T2.01 |
