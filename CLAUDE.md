# CLAUDE.md

## Local Qwen for small subtasks

When a subtask is small and self-contained (a helper function, boilerplate, data lists, short text such as UI copy or descriptions), send it to the local Qwen model first, then review its output before using it:

- Ollama at `http://localhost:11434/api/generate`, model `qwen3:4b-instruct`, `"stream": false`
- Call it with PowerShell `Invoke-RestMethod`, passing only the task and any small relevant snippet
- Check the reply for syntax errors and fit with the surrounding code before applying it

Keep anything that spans multiple files, debugging, play-test fixes, and design decisions for Claude itself. If Ollama isn't reachable, just do the task directly.
