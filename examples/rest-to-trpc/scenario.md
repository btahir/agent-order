# Scenario: REST to tRPC Migration

A small TypeScript product team is considering migrating its internal API from REST endpoints to tRPC.

The app has:

- Next.js frontend
- Node backend
- mobile clients planned within six months
- four engineers
- moderate API churn
- a few external integration partners

## Constraints

- Do not optimize only for type safety.
- Consider migration cost, external clients, hiring, debugging, and long-term maintainability.
- The team wants a decision memo they can turn into an ADR.

## Expected Output

Recommend whether to migrate now, defer, or use a hybrid approach. Include a migration plan only if migration is recommended.
