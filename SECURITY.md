# Security

Report vulnerabilities privately through GitHub's advisory form: https://github.com/vrash/jeval/security/advisories/new (or email the maintainer listed on the website's contact line). Please do not open a public issue for security problems.

What counts: anything that lets an anonymous visitor read or alter waitlist data, bypass the waitlist or demo endpoint controls, execute script through evaluated content in HTML reports or the site, or leak API keys from the CLI or reports.

Scope notes:
- The waitlist database is protected by row-level security and revoked anonymous grants; the server endpoint is the only writer.
- The CLI never prints API keys or case content unless `--show` is passed.
- HTML reports escape all dataset content and ship a strict Content-Security-Policy.

We aim to acknowledge reports within a few days. There is no bug bounty.
