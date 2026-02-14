# Swarm Patterns — MiniMax M2.5 Prompt Templates

Reference document for copus: skills. Defines prompt patterns for MiniMax delegation.

## When to Use MiniMax (via llm_batch)

- File scanning (5+ files, pattern-based analysis)
- Verification of proposed edits (SAFE/UNSAFE check)
- Parallel code analysis (multi-file review pre-scan)
- Mechanical implementation (JSON edit arrays for trivial/easy/medium tasks)

## When NOT to Use MiniMax

- Architecture decisions
- Security-critical analysis
- Complex refactoring
- Anything requiring tool use (MiniMax is text-in, text-out only)

## Prompt Templates

### Verify Edit Safety

```
Verify this code edit is correct and safe.

File: {file_path}
File content:
```
{file_content}
```

Proposed edit:
  OLD: {old_string}
  NEW: {new_string}

Context: {description}

Respond with ONLY one of:
- SAFE
- UNSAFE: [reason]
```

### Implement Task (JSON Edit Array)

```
Implement this change to the given file.

## Task
{task_description}

## File: {file_path}
```
{file_content}
```

## Instructions
{what_to_do}

## Return Format
Return ONLY a JSON array of edits:
[{"old_string": "exact text to find", "new_string": "replacement text"}]
No explanations, no markdown fences, just the raw JSON array.
```

### File Analysis (Pre-Scan)

```
Review this file for bugs, security issues, and code quality problems.
File: {path}
Content: {content}
Return a JSON array of issues: [{"line": N, "severity": "critical|warning|info", "description": "..."}]
```

## Cost Guidelines

- Simple verification: ~500 input + ~50 output = ~$0.0001
- File analysis: ~2K input + ~500 output = ~$0.0009
- Implementation: ~3K input + ~1K output = ~$0.0017
- Batch of 10: ~$0.009 vs ~$2.50 on Opus = 99.6% savings

## Graceful Degradation

Every skill MUST work without MiniMax:
1. Check if `mcp__llm-swarm__llm_batch` is available
2. If yes: use MiniMax for eligible tasks
3. If no: execute all tasks with Opus (existing behavior)

Never fail because MiniMax is unavailable.
