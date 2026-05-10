<!--
source_id: openai-codex-app-settings
source_url: https://developers.openai.com/codex/app/settings
reader: jina
reader_url: https://r.jina.ai/https://developers.openai.com/codex/app/settings
fetched_at: 2026-05-10T07:47:41.588Z
-->

# Codex app settings

Configure Codex app behavior and preferences


Use the settings panel to tune how the Codex app behaves, how it opens files, and how it connects to tools. Open [**Settings**](codex://settings) from the app menu or press Cmd+,.

## General

Choose where files open and how much command output appears in threads. You can also require Cmd+Enter for multiline prompts or prevent sleep while a thread runs.

## Notifications

Choose when turn completion notifications appear, and whether the app should prompt for notification permissions.

## Agent configuration

Codex agents in the app inherit the same configuration as the IDE and CLI extension. Use the in-app controls for common settings, or edit `config.toml` for advanced options. See [Codex security](https://developers.openai.com/codex/agent-approvals-security) and [config basics](https://developers.openai.com/codex/config-basic) for more detail.

## Appearance

In **Settings**, you can change the Codex app appearance by choosing a base theme, adjusting accent, background, and foreground colors, and changing the UI and code fonts. You can also share your custom theme with friends.

![Image 2: Codex app Appearance settings showing theme selection, color controls, and font options](https://developers.openai.com/images/codex/app/theme-selection-light.webp)![Image 3: Codex app Appearance settings showing theme selection, color controls, and font options](https://developers.openai.com/images/codex/app/theme-selection-dark.webp)

![Image 4: Codex app Appearance settings showing theme selection, color controls, and font options](https://developers.openai.com/images/codex/app/theme-selection-light.webp)![Image 5: Codex app Appearance settings showing theme selection, color controls, and font options](https://developers.openai.com/images/codex/app/theme-selection-dark.webp)

### Codex pets

Codex pets are optional animated companions for the app. In **Settings**, go to **Appearance** and choose **Pets** to select a built-in pet or refresh custom pets from your local Codex home. Type `/pet` in the composer, use **Wake Pet** or **Tuck Away Pet** in **Settings > Appearance**, or press Cmd+K or Ctrl+K and run the same commands to toggle the floating overlay.

The overlay keeps active Codex work visible while you use other apps. It shows the active thread, reflects whether Codex is running, waiting for input, or ready for review, and pairs that state with a short progress prompt so you can glance at what changed without reopening the thread.

8/8

Null Signal No new alerts. I am still listening for the next signal.

To create your own pet, install the `hatch-pet` skill:

`$skill-installer hatch-pet`
Reload skills from the command menu. Press Cmd+K or Ctrl+K, choose **Force Reload Skills**, then ask the skill to create a pet:

`$hatch-pet create a new pet inspired by my recent projects`
## Git

Use Git settings to standardize branch naming and choose whether Codex uses force pushes. You can also set prompts that Codex uses to generate commit messages and pull request descriptions.

## Integrations & MCP

Connect external tools via MCP (Model Context Protocol). Enable recommended servers or add your own. If a server requires OAuth, the app starts the auth flow. These settings also apply to the Codex CLI and IDE extension because the MCP configuration lives in `config.toml`. See the [Model Context Protocol docs](https://developers.openai.com/codex/mcp) for details.

## Browser use

Use these settings to install or enable the bundled Browser plugin, set up the [Codex Chrome extension](https://developers.openai.com/codex/app/chrome-extension), and manage allowlisted and blocklisted websites. Codex asks before using a website unless you’ve allowlisted it. Removing a site from the blocklist lets Codex ask again before using it in the browser.

See [In-app browser](https://developers.openai.com/codex/app/browser) for browser preview, comment, and browser use workflows.

## Computer Use

On macOS, check your Computer Use settings to review desktop-app access and related preferences after setup. To revoke system-level access, update Screen Recording or Accessibility permissions in macOS Privacy & Security settings. The feature isn’t available in the EEA, the United Kingdom, or Switzerland at launch.

## Personalization

Choose **Friendly**, **Pragmatic**, or **None** as your default personality. Use **None** to disable personality instructions. You can update this at any time.

You can also add your own custom instructions. Editing custom instructions updates your [personal instructions in `AGENTS.md`](https://developers.openai.com/codex/guides/agents-md).

## Context-aware suggestions

Use context-aware suggestions to surface follow-ups and tasks you may want to resume when you start or return to Codex.

## Memories

Enable Memories, where available, to let Codex carry useful context from past threads into future work. See [Memories](https://developers.openai.com/codex/memories) for setup, storage, and per-thread controls.

## Archived threads

The **Archived threads** section lists archived chats with dates and project context. Use **Unarchive** to restore a thread.

[Previous Features](https://developers.openai.com/codex/app/features)[Next Review](https://developers.openai.com/codex/app/review)
