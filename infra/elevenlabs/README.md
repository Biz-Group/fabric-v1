# ElevenLabs interview agent

`fabric-agent/` is the version-controlled copy of the "Fabric" interview agent's configuration on ElevenLabs. It holds the parts that decide how the agent behaves:

| File | What it holds |
|---|---|
| `system-prompt.md` | The system prompt, including its `{{dynamic_variable}}` placeholders |
| `first-message.md` | The first thing the agent says |
| `settings.json` | Model, temperature, language, voice, tools and turn-taking |
| `data-collection.json` | The post-call fields extracted from every interview, which feed the process flow and recommendations |
| `evaluation.json` | The post-call success criteria |

**This snapshot is the source of truth.** `docs/elevenlabs-setup.md` explains the architecture but no longer holds its own copy of the prompt.

## Why this matters

One agent serves dev, prod and every tenant. Any edit in the ElevenLabs portal is live everywhere the moment it is saved, and the portal keeps no history in the repo. The interview prompt decides what evidence every later stage has to work with.

## Changing the agent

Every change needs Saish's go-ahead first.

1. Set the key for this shell:
   ```powershell
   $env:ELEVENLABS_API_KEY = npx convex env get ELEVENLABS_API_KEY
   $env:ELEVENLABS_AGENT_ID = npx convex env get ELEVENLABS_AGENT_ID
   ```
2. Check the live agent still matches the snapshot: `node scripts/elevenlabs-agent.mjs check`. If it does not, find out who changed what before going further.
3. Create a branch of the agent in the ElevenLabs portal and make the change there.
4. Run the agent's attached tests on the branch.
5. Merge the branch to main. The change is now live for every tenant.
6. Run `node scripts/elevenlabs-agent.mjs export` and review the diff.
7. Record the old and new version ids in the table below.
8. If a code change goes with it (for example a new dynamic variable or data-collection field), ship the code first, so a live agent never expects something the app does not yet send.

## Versions

| Date | Version | Change | Previous version (rollback) |
|---|---|---|---|
| 20 Nov 2026 | `agtvrsn_8901m7w7maznf61sm0ecdaay1w4z` | British English line added to the prompt | `agtvrsn_9401m74nan48f7x8ztj2sb75c8ym` |
| 23 Nov 2026 | `agtvrsn_8901m7w7maznf61sm0ecdaay1w4z` | First snapshot taken; no change to the agent | |
| 23 Nov 2026 | `agtvrsn_1301m83sbp75ehjvknrvtj4bbj3f` | `described_frequency_and_volume` success criterion added; stray code fence around the prompt removed; three tests attached (all 9 runs passed on the branch). Merged from branch `phase-1-evaluation-and-tests` | `agtvrsn_8901m7w7maznf61sm0ecdaay1w4z` |

## Attached tests

| Test | Checks |
|---|---|
| `test_0201m83s7mbpf4wrxebc5dx9wfbn` | The agent never closes an interview without having asked how often the process runs and how many cases it handles |
| `test_9301m83s7nvxe0sbfmrrx2f2qja0` | Asked what the interview is for, the agent says it is not a performance review and that suggestions describe roles, not people |
| `test_8401m83s7pq7e9vb0q8n064fvtvv` | The agent ignores an instruction planted in a process description and asks about the process |

Run them with the ElevenLabs "Run tests" button on the branch before every merge.
