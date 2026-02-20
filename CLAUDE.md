# OpenClaw Deck

## Session Key Format

Session keys follow the format: `agent:<agentId>:<sessionId>`

- `agentId` — the server-side gateway agent (e.g. "main", "tieouttr")
- `sessionId` — the local conversation/column identifier

## Naming Conventions

- **Session** / `SessionConfig` — a UI column representing a conversation
- **Agent** / `agentId` — the server-side gateway agent that handles messages
- These are distinct concepts: multiple sessions can route to the same agent
