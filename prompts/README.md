# Prompts

Each file is one prompt, versioned in its name: `<name>.v<N>.md`. The highest version is
used, and its version string (e.g. `draft-generation.v1`) is logged with every generation
(`ai_generations.prompt_version`, `post_versions.prompt_version`). To change a prompt, add a
new version file rather than editing the old one.

Placeholders use `{{name}}` and are filled in code. Every call asks for JSON output that is
validated against a schema (OpenAI structured outputs).
