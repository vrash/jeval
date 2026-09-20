#!/usr/bin/env node
/**
 * Operator-only admin tool for the jeval Cloud waitlist.
 *
 *   node scripts/waitlist-admin.mjs count
 *   node scripts/waitlist-admin.mjs export [--csv]
 *   node scripts/waitlist-admin.mjs delete --email <address>
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment (service role only;
 * anon keys are denied by RLS and revoked grants). The key is never printed.
 *
 * @supabase/supabase-js is resolved from apps/web's dependencies so nothing is added to the
 * repository root.
 */
import { createRequire } from "node:module";
import process from "node:process";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { createClient } = require("@supabase/supabase-js");

const TABLE = "waitlist_signups";
const COLUMNS = ["id", "email", "use_case", "source", "campaign", "notice_version", "created_at"];

function usage(code = 1) {
  process.stderr.write(
    [
      "Usage:",
      "  waitlist-admin.mjs count",
      "  waitlist-admin.mjs export [--csv]",
      "  waitlist-admin.mjs delete --email <address>",
      "",
      "Environment: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY",
      "",
    ].join("\n"),
  );
  process.exit(code);
}

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function getClient() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    fail("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment.", 2);
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function normaliseEmail(email) {
  return String(email).trim().toLowerCase();
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function fetchAll(client) {
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from(TABLE)
      .select(COLUMNS.join(","))
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) fail(`Export failed: ${error.message}`);
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

async function cmdCount(client) {
  const { count, error } = await client.from(TABLE).select("id", { count: "exact", head: true });
  if (error) fail(`Count failed: ${error.message}`);
  process.stdout.write(`${count}\n`);
}

async function cmdExport(client, args) {
  const rows = await fetchAll(client);
  if (args.includes("--csv")) {
    const lines = [COLUMNS.join(",")];
    for (const row of rows) lines.push(COLUMNS.map((c) => csvCell(row[c])).join(","));
    process.stdout.write(`${lines.join("\n")}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
  }
}

async function cmdDelete(client, args) {
  const idx = args.indexOf("--email");
  const raw = idx >= 0 ? args[idx + 1] : undefined;
  if (!raw) fail("delete requires --email <address>", 1);
  const email = normaliseEmail(raw);
  const { data, error } = await client.from(TABLE).delete().eq("email", email).select("id");
  if (error) fail(`Delete failed: ${error.message}`);
  process.stdout.write(`${data.length}\n`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || ["-h", "--help", "help"].includes(command)) usage(command ? 0 : 1);
  const client = getClient();
  switch (command) {
    case "count":
      return cmdCount(client);
    case "export":
      return cmdExport(client, args);
    case "delete":
      return cmdDelete(client, args);
    default:
      return usage(1);
  }
}

main().catch((error) => {
  // Print only the message: never dump objects that could contain the client config.
  fail(error instanceof Error ? error.message : String(error));
});
