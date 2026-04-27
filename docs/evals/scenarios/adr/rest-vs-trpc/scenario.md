# ADR: REST vs tRPC for the new internal admin API

Decide whether the new internal admin API should be REST (OpenAPI-defined) or tRPC.

Context:

- The existing public API is REST and is staying REST.
- The admin API is for an internal tool used by ~30 employees. Frontend is a TypeScript SPA owned by the same team that owns the backend (TypeScript on Node).
- The team has shipped both REST and tRPC services in the past; recent on-call pain has been higher with REST due to type drift.
- The team wants to ship the first slice in three weeks. Long-term plan is to migrate the public API in 18 months.
- Observability stack (metrics, traces, logs) is shared and works with both.

Produce an ADR that captures the decision, the alternatives that were rejected, and the reversibility / migration story.
