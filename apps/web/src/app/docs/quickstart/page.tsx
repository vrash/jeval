import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { QUICKSTART_CLONE, QUICKSTART_INIT, QUICKSTART_LIVE, SDK_EXAMPLE } from "@/lib/snippets";
import { DocTitle, docMetadata } from "../doc-page";

export const metadata = docMetadata("quickstart");

export default function Page() {
  return (
    <>
      <DocTitle slug="quickstart" />
      <div className="prose">
        <p>
          jeval is a pnpm workspace. Until the packages are published you install from a clone or from locally packed tarballs; the site never
          claims they are on npm. Node 22 (≥ 20.9) and pnpm 10 are required.
        </p>
        <h2 id="install">1. Clone and build</h2>
        <CodeBlock code={QUICKSTART_CLONE} lang="bash" />
        <p>
          Run <code>pnpm check</code> to lint, typecheck, build and test everything offline. Nothing here needs a TypeSafe key.
        </p>
        <h2 id="try">2. Try the bundled example</h2>
        <CodeBlock
          code={`pnpm --filter jeval-examples cli      # jeval run --mode fixture on examples/data (simulated)
pnpm --filter jeval-examples sdk      # runs examples/sdk-example.ts
open examples/runs/*.html             # self-contained report`}
          lang="bash"
        />
        <p>
          Fixture mode uses deterministic simulated answers and is marked <b>SIMULATED</b> in every output. It shows how the framework behaves; it says
          nothing about how Jev judges.
        </p>
        <h2 id="project">3. Start your own project</h2>
        <CodeBlock code={QUICKSTART_INIT} lang="bash" />
        <p>
          <code>jeval init</code> writes <code>jeval.config.json</code>, <code>rubrics.json</code>, a four-case <code>dataset.jsonl</code>,{" "}
          <code>fixtures.json</code> and <code>.env.example</code> without overwriting existing files. To install the CLI into another project, pack
          the workspace packages (<code>pnpm -r --filter &apos;./packages/*&apos; pack</code>) and add the tarballs as dependencies; the repository&apos;s{" "}
          <code>scripts/verify-packed.sh</code> does exactly that as a check.
        </p>
        <h2 id="live">4. Run against Jev</h2>
        <CodeBlock code={QUICKSTART_LIVE} lang="bash" />
        <p>
          Live mode sends the built judge state for each case (input, output, conversation, policy, references and tool events) to TypeSafe using
          your key. Expected labels and metadata never leave your machine. Usage is measured per request and cost is shown as an estimate from the
          rate in your config. See <Link href="/docs/jev">Jev integration</Link>.
        </p>
        <h2 id="sdk">5. Evaluate inside your application</h2>
        <p>
          The same API works after your app generates a response. Pass the case, the rubrics and a provider; you get back statuses, reasons,
          probabilities and request usage.
        </p>
        <CodeBlock code={SDK_EXAMPLE} lang="ts" title="examples/sdk-example.ts" />
        <p>
          Next: <Link href="/docs/cases">Evaluation cases</Link>, <Link href="/docs/rubrics">Rubrics</Link>, <Link href="/docs/ci">Reports and CI gates</Link>.
        </p>
      </div>
    </>
  );
}
