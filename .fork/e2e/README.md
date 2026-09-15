# Billing setup for Lighthouse

The upstream Lighthouse test seeds a chat user without a Lago subscription. The
fork's subscription guard can replace the chat after its initial render, leaving
Lighthouse with a detached LCP element or preventing the transcript from appearing.

`billing.ts` supplies environment settings only to the isolated Lighthouse server.
It uses the existing email allowlist for the account selected by upstream's
`getE2EUser()`. It clears inherited user-ID exemptions and points Lago at a closed
loopback port with a placeholder credential, so the audit cannot contact production
billing. Production code does not import this fixture or bypass subscription checks.

The only upstream wiring is the `lighthouse-billing-fixture` sentinel in
`e2e/playwright.config.lighthouse.ts`. Performance budgets and transcript assertions
remain upstream's originals. Route and fixture regression tests live in
`api/server/forked-code/routes/lago.spec.js`.
