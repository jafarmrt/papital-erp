# AI Agent Instructions (GEMINI.md)

This file is a quick reference and stub. The single source of truth for all architectural rules and governance is **AGENTS.md** (root).

See also: `V6_MASTER_ROADMAP.md` (active execution roadmap) • `TECH_DEBT.md` (debt registry) • `README.md` (setup & operations).

---

## AI Studio Rate Limit & Token Quota Preservation (CRITICAL)
- **Do NOT run full test suite (`npm test` / `npm run test:full`) inside interactive chat turns:**
  The full runner executes 15+ suites and produces massive terminal logs. In long conversations, this rapidly blows past the 2,000,000 Input Tokens/Minute (TPM) quota, triggering `resource_exhausted` and model overload.
- **Fast, Lightweight Verification:**
  Always verify code using type checking (`lint_applet` / `npm run lint`) and compilation (`compile_applet` / `npm run build`).
- **Targeted Test Execution Only:**
  If verifying DB logic, invoke ONLY the single relevant suite (e.g. `npx tsx scripts/run-tests.ts --suite database`).
- **Context Refresh:**
  Advise user to initiate a New Chat when a task milestone finishes or conversation length exceeds 20 turns.

