<!--
source_id: anthropic-claude-memory-tool
source_url: https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool
reader: jina
reader_url: https://r.jina.ai/https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool
fetched_at: 2026-05-10T07:57:38.046Z
-->

# Memory tool

Messages Tools

The memory tool enables Claude to store and retrieve information across conversations through a memory file directory. Claude can create, read, update, and delete files that persist between sessions, allowing it to build knowledge over time without keeping everything in the context window.

This is the key primitive for just-in-time context retrieval: rather than loading all relevant information upfront, agents store what they learn in memory and pull it back on demand. This keeps the active context focused on what's currently relevant, critical for long-running workflows where loading everything at once would overwhelm the context window. See [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) for the broader pattern.

The memory tool operates client-side: you control where and how the data is stored through your own infrastructure.

Reach out through the [feedback form](https://forms.gle/YXC2EKGMhjN1c4L88) to share your feedback on this feature.

This feature is eligible for [Zero Data Retention (ZDR)](https://platform.claude.com/docs/en/build-with-claude/api-and-data-retention). When your organization has a ZDR arrangement, data sent through this feature is not stored after the API response is returned.

## Use cases

*   Maintain project context across multiple agent executions
*   Learn from past interactions, decisions, and feedback
*   Build knowledge bases over time
*   Enable cross-conversation learning where Claude improves at recurring workflows

## How it works

When enabled, Claude automatically checks its memory directory before starting tasks. Claude can create, read, update, and delete files in the `/memories` directory to store what it learns while working, then reference those memories in future conversations to handle similar tasks more effectively or pick up where it left off.

Since this is a client-side tool, Claude makes tool calls to perform memory operations, and your application executes those operations locally. This gives you complete control over where and how the memory is stored. For security, you should restrict all memory operations to the `/memories` directory.

### Example: How memory tool calls work

When you ask Claude to help with a task, Claude automatically checks its memory directory first. Here's what a typical interaction looks like:

**1. User request:**

**2. Claude checks the memory directory:**

Claude calls the memory tool:

**3. Your application returns the directory contents:**

**4. Claude reads relevant files:**

**5. Your application returns the file contents:**

**6. Claude uses the memory to help:**

For model support, see the [Tool reference](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-reference).

## Getting started

To use the memory tool:

1.   Add the memory tool to your request
2.   Implement client-side handlers for memory operations

To handle memory tool operations in your application, you need to implement handlers for each memory command. The SDKs provide memory tool helpers that handle the tool interface. You can subclass `BetaAbstractMemoryTool` (Python) or use `betaMemoryTool` (TypeScript) to implement your own memory backend (file-based, database, cloud storage, encrypted files, etc.).

For working examples, see:

*   Python: [examples/memory/basic.py](https://github.com/anthropics/anthropic-sdk-python/blob/main/examples/memory/basic.py)
*   TypeScript: [examples/tools-helpers-memory.ts](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/examples/tools-helpers-memory.ts)

## Basic usage

## Tool commands

Your client-side implementation needs to handle these memory tool commands. While these specifications describe the recommended behaviors that Claude is most familiar with, you can modify your implementation and return strings as needed for your use case.

### view

Shows directory contents or file contents with optional line ranges:

#### Return values

**For directories:** Return a listing that shows files and directories with their sizes:

*   Lists files up to 2 levels deep
*   Shows human-readable sizes (for example, `5.5K`, `1.2M`)
*   Excludes hidden items (files starting with `.`) and `node_modules`
*   Uses tab character between size and path

**For files:** Return file contents with a header and line numbers:

Line number formatting:

*   **Width**: 6 characters, right-aligned with space padding
*   **Separator**: Tab character between line number and content
*   **Indexing**: 1-indexed (first line is line 1)
*   **Line limit**: Files with more than 999,999 lines should return an error: `"File {path} exceeds maximum line limit of 999,999 lines."`

**Example output:**

#### Error handling

*   **File/directory does not exist**: `"The path {path} does not exist. Please provide a valid path."`

### create

Create a new file:

#### Return values

*   **Success**: `"File created successfully at: {path}"`

#### Error handling

*   **File already exists**: `"Error: File {path} already exists"`

### str_replace

Replace text in a file:

#### Return values

*   **Success**: `"The memory file has been edited."` followed by a snippet of the edited file with line numbers

#### Error handling

*   **File does not exist**: `"Error: The path {path} does not exist. Please provide a valid path."`
*   **Text not found**: `"No replacement was performed, old_str `\{old_str}` did not appear verbatim in {path}."`
*   **Duplicate text**: When `old_str` appears multiple times, return: `"No replacement was performed. Multiple occurrences of old_str `\{old_str}` in lines: {line_numbers}. Please ensure it is unique"`

#### Directory handling

If the path is a directory, return a "file does not exist" error.

### insert

Insert text at a specific line:

#### Return values

*   **Success**: `"The file {path} has been edited."`

#### Error handling

*   **File does not exist**: `"Error: The path {path} does not exist"`
*   **Invalid line number**: `"Error: Invalid `insert_line` parameter: {insert_line}. It should be within the range of lines of the file: [0, {n_lines}]"`

#### Directory handling

If the path is a directory, return a "file does not exist" error.

### delete

Delete a file or directory:

#### Return values

*   **Success**: `"Successfully deleted {path}"`

#### Error handling

*   **File/directory does not exist**: `"Error: The path {path} does not exist"`

#### Directory handling

Deletes the directory and all its contents recursively.

### rename

Rename or move a file/directory:

#### Return values

*   **Success**: `"Successfully renamed {old_path} to {new_path}"`

#### Error handling

*   **Source does not exist**: `"Error: The path {old_path} does not exist"`
*   **Destination already exists**: Return an error (do not overwrite): `"Error: The destination {new_path} already exists"`

#### Directory handling

Renames the directory.

## Prompting guidance

This instruction is automatically included in the system prompt when the memory tool is enabled:

If you observe Claude creating cluttered memory files, you can include this instruction:

> Note: when editing your memory folder, always try to keep its content up-to-date, coherent and organized. You can rename or delete files that are no longer relevant. Do not create new files unless necessary.

You can also guide what Claude writes to memory. For example: "Only write down information relevant to <topic> in your memory system."

## Security considerations

Here are important security concerns when implementing your memory store:

### Sensitive information

Claude will usually refuse to write down sensitive information in memory files. However, you may want to implement stricter validation that strips out potentially sensitive information.

### File storage size

Consider tracking memory file sizes and preventing files from growing too large. Consider adding a maximum number of characters the memory read command can return, and let Claude paginate through contents.

### Memory expiration

Consider clearing out memory files periodically that haven't been accessed in an extended time.

### Path traversal protection

Malicious path inputs could attempt to access files outside the `/memories` directory. Your implementation **MUST** validate all paths to prevent directory traversal attacks.

Consider these safeguards:

*   Validate that all paths start with `/memories`
*   Resolve paths to their canonical form and verify they remain within the memory directory
*   Reject paths containing sequences like `../`, `..\\`, or other traversal patterns
*   Watch for URL-encoded traversal sequences (`%2e%2e%2f`)
*   Use your language's built-in path security utilities (for example, Python's `pathlib.Path.resolve()` and `relative_to()`)

## Error handling

The memory tool uses similar error handling patterns to the [text editor tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/text-editor-tool#handle-errors). See the individual tool command sections above for detailed error messages and behaviors. Common errors include file not found, permission errors, invalid paths, and duplicate text matches.

## Context editing integration

The memory tool pairs with context editing to manage long-running conversations. For details, see [Context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing).

## Using with Compaction

The memory tool can also be paired with [compaction](https://platform.claude.com/docs/en/build-with-claude/compaction), which provides server-side summarization of older conversation context. While context editing clears specific tool results on the client side, compaction automatically summarizes the entire conversation on the server side when it approaches the context window limit.

For long-running agentic workflows, consider using both: compaction keeps the active context manageable without client-side bookkeeping, and memory persists important information across compaction boundaries so that nothing critical is lost in the summary.

## Multi-session software development pattern

For long-running software projects that span multiple agent sessions, memory files need to be bootstrapped deliberately, not just written ad hoc as work progresses. The pattern below turns memory into a structured recovery mechanism, so each new session can pick up exactly where the last one left off.

### How it works

1.   **Initializer session:** The first session sets up the memory artifacts before any substantive work begins. This includes a progress log (tracking what has been done and what comes next), a feature checklist (defining the scope of work), and a reference to any startup or initialization script the project needs.

2.   **Subsequent sessions:** Each new session opens by reading those memory artifacts. This recovers the full state of the project in seconds, without needing to re-explore the codebase or retrace earlier decisions.

3.   **End-of-session update:** Before a session ends, it updates the progress log with what was completed and what remains. This ensures the next session has an accurate starting point.

### Key principle

Work on one feature at a time. Only mark a feature complete after end-to-end verification confirms it works, not just after the code is written. This keeps the progress log trustworthy and prevents scope creep from compounding across sessions.

For a detailed case study of this pattern in practice, including the initializer script, progress file structure, and git-based recovery, see [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents).

## Next steps

Was this page helpful?
