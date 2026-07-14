# Fabric Foundry infrastructure

This directory is based on Microsoft's `azd-ai-starter-basic` template and is configured for separate Sweden Central development and production environments. It provisions only the Foundry account/project and monitoring resources; hosted agents and capability hosts are disabled.

See [`docs/foundry-migration-runbook.md`](../../docs/foundry-migration-runbook.md) for provisioning, model deployment, Convex secrets, smoke tests, cutover, rollback, costs, and retirement dates.

The account temporarily permits local/API-key authentication because Convex uses an API key in the first migration phase. Set `disableLocalAuth: true` in `infra/core/ai/ai-project.bicep` when Entra ID authentication is implemented.
