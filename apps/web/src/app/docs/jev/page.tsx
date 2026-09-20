import { CodeBlock } from "@/components/code-block";
import { JEV_DOCS_URL } from "@/lib/site";
import { DocTitle, docMetadata } from "../doc-page";

export const metadata = docMetadata("jev");

export default function Page() {
  return (
    <>
      <DocTitle slug="jev" />
      <div className="prose">
        <p>
          The first judge provider is <code>@jeval/provider-jev</code>, built on <code>@typesafe-ai/sdk</code> 0.6.0. The integration was verified on
          2026-09-19 against the installed type declarations and the pages at <a href={JEV_DOCS_URL} rel="noopener">docs.typesafe.ai</a> (JavaScript
          SDK, choice primitive, confidence, models, API reference). If TypeSafe changes its API, the adapter&apos;s tests will tell you.
        </p>
        <h2 id="what">What is sent</h2>
        <p>
          One <code>POST /v1/systemone</code> per case with <code>state</code> (the judge state built from the case) and a <code>questions</code> map of{" "}
          <code>choice</code> questions, one per semantic check part. The <code>model</code> is configurable (<code>jev-latest</code> by default; the docs
          also list <code>jev-1.13.0</code> and <code>jev-preview</code>), and the versioned model id the server actually used is stored on every case
          result.
        </p>
        <CodeBlock
          code={`import { JevProvider } from "@jeval/provider-jev";
const provider = new JevProvider({ model: "jev-1.13.0", timeoutMs: 20_000 }); // apiKey defaults to TYPESAFE_API_KEY`}
          lang="ts"
        />
        <h2 id="gateway">Via Vercel AI Gateway</h2>
        <p>
          Vercel&apos;s AI Gateway proxies TypeSafe&apos;s native API, so you can run Jeval without a TypeSafe account and be billed by Vercel instead.
          Point the same adapter at the gateway; nothing else changes. Vercel requires a card on file before it serves requests. Through the gateway the returned
          model id is whatever you requested (<code>typesafe-ai/jev</code> or <code>jev-latest</code>), not a resolved version, so pin a versioned id
          via the direct API when you need exact model tracking across runs.
        </p>
        <CodeBlock
          code={`TYPESAFE_API_KEY=<AI Gateway API key or VERCEL_OIDC_TOKEN>
TYPESAFE_BASE_URL=https://ai-gateway.vercel.sh/typesafe
TYPESAFE_DEFAULT_MODEL=typesafe-ai/jev`}
          lang="bash"
          title=".env"
        />
        <h2 id="answers">Probabilities and confidence</h2>
        <p>
          Each answer carries the selected option, a full probability distribution over the options, and a <code>confidence</code> number. Per TypeSafe&apos;s
          documentation, confidence is a statistic computed from the shape of that distribution: it says how peaked the answer is, not whether the answer
          is right. Jeval decides using the probabilities and your thresholds, stores confidence alongside them, and never presents it as accuracy.
        </p>
        <h2 id="usage">Usage, cost and limits</h2>
        <p>
          Token usage is returned per request and recorded once per case, so a request carrying five questions is not counted five times. Cost is an
          estimate: the CLI multiplies measured input tokens by the rate in your config and records that rate and its date. The documented rate on the
          verification date was listed on TypeSafe&apos;s models page; check it before relying on it. Documented limits: 64k tokens per request, 32k for
          state plus the longest question, 255 options per question. Rate limits are enforced server-side and are adjusted dynamically; Jeval retries 429
          and 5xx responses with backoff and honours Retry-After.
        </p>
        <h2 id="errors">Errors</h2>
        <p>
          Authentication and validation errors fail fast. Rate limits, timeouts, connection failures and server errors (including 529 overloaded) are
          transient and retried up to <code>maxAttempts</code>. Any response that lacks an answer, offers different options than asked, or whose
          probabilities do not sum to one is reported as an <b>error</b>, never turned into a decision.
        </p>
        <h2 id="fixture">Fixture mode</h2>
        <p>
          <code>FixtureProvider</code> returns hand-authored or deterministic fallback answers, reports zero latency and marks every response simulated. It
          exists for development and tests. Jeval never substitutes it for a failed real provider.
        </p>
      </div>
    </>
  );
}
