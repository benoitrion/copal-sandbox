import type { ApiErrorBody } from "./types";
export const error_422 = {
 "error": "invalid policy: broken expected exactly one of deny, pattern, secrets, dependencies, requireTest; got none"
} satisfies ApiErrorBody;
