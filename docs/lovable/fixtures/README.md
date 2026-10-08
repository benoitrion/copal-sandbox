# Copal API fixtures

Real responses captured from the reference mock backend (`apps/mock-server`) after `npm run e2e`. Use them as the in-app mock data so the UI is built against the exact API shapes.

| File | Endpoint |
|---|---|
| `status.json` | `GET /v1/status` |
| `projects.json` | `GET /v1/projects` |
| `policy.json` | `GET /v1/projects/billing-api/policy?file=src/web/invoice-controller.ts` |
| `analyses.json` | `GET /v1/analyses` (11 analyses: pre-commit, PR, branch) |
| `analysis-pr.json` | `GET /v1/analyses/:id` (PR `acme/billing-api#250`, 4 blocking findings) |
| `metrics.json` | `GET /v1/metrics` |
| `suggestions.json` | `GET /v1/suggestions?project=billing-api` |
| `mentor.json` | `POST /v1/mentor` (scenario 01 snippet; the AWS key is redacted) |
| `plan.json` | `POST /v1/plan` |
| `analyze-request.json` / `analyze-response.json` | `POST /v1/analyze` (scenario 01, environment `local`) |
| `error-401.json` | any `/v1/*` call without a key |
| `error-422.json` | `PUT /v1/projects/:name/policy` with an invalid rule |

Regenerate: `KEEP=1 npm run e2e`, then call the endpoints with `x-api-key: copal_dev_local`.

Typed versions (`export const x = {...} satisfies Type`) for frontend mocks live in [`../mocks`](../mocks).
