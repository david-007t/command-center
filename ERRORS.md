# ERRORS.md
# Last updated: 2026-04-15

## Active errors

- Description: Command Center still has gaps where repo-root self-management is not treated exactly like other managed projects.
- Impact: Runtime state, investigations, and tracked improvements can drift unless every project-loading and feedback path resolves `command-center` correctly.

## Patterns — updated by Scout

- Self-management bugs usually come from assumptions that every project lives under `DEVELOPER_PATH/<name>`.
- Trust gaps appear when feedback and runtime artifacts update in different places.
