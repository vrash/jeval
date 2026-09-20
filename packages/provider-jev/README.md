# @jeval/provider-jev

jeval judge provider for TypeSafe's Jev, built on `@typesafe-ai/sdk` 0.6.0 (verified 2026-09-19 against the SDK type declarations and docs.typesafe.ai).

```ts
import { JevProvider } from "@jeval/provider-jev";
const provider = new JevProvider({ model: "jev-latest" }); // apiKey defaults to TYPESAFE_API_KEY
```

Each jeval check becomes one `choice` question; every question for a case is sent in a single `systemOne` request. Real requests send the built judge state to TypeSafe. Provisional package name; not yet published.
