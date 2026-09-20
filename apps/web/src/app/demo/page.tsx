import type { Metadata } from "next";
import Link from "next/link";
import { Demo } from "@/components/demo";

export const metadata: Metadata = {
  title: "Demo",
  description: "Inspect three fictional cases, select checks, and see how Jeval turns judge probabilities into pass, fail or review.",
  alternates: { canonical: "/demo" },
};

export default function DemoPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Interactive demo</h1>
      <p className="mt-3 max-w-2xl text-fg-muted">
        Three fictional presets from a dental booking assistant. Pick one, choose which checks to run, and inspect each outcome with its
        probabilities. By default the answers are <b>simulated</b> fixtures bundled with the site, so nothing is sent anywhere. Real evaluation of
        arbitrary inputs happens locally with the CLI and your own TypeSafe key.
      </p>
      <div className="mt-8">
        <Demo />
      </div>
      <div className="prose mt-10">
        <h2>Failed check versus insufficient evidence</h2>
        <p>
          A <b>fail</b> is a decision: the probability of the unacceptable outcome reached the fail threshold, or an exact rule fired, such as a
          success claim contradicting a recorded tool failure. A <b>review</b> is an abstention: the references did not cover the claim, no tool
          event was recorded for a claimed action, or the distribution was too flat to decide. Treating a review as a fail would punish honest
          uncertainty; treating it as a pass would hide problems. Jeval reports both counts separately and never folds review into a pass rate.
        </p>
        <p>
          Read more in <Link href="/docs/rubrics">Rubrics</Link> and <Link href="/docs/ci">Reports and CI gates</Link>.
        </p>
      </div>
    </div>
  );
}
