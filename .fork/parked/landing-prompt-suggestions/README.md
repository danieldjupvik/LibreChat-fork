# Parked: landing prompt suggestions

Fork-only starter-prompt UI that used to render on the chat landing screen —
four category tabs (Create / Explore / Code / Learn), each with four suggested
prompts, plus a staggered fade-in timed to land after the greeting's `SplitText`
animation. Clicking a suggestion cleared the composer and set it as the active
prompt.

Removed on 2026-08-25 to return the landing screen to pure upstream. Everything
needed to bring it back is kept here verbatim:

- `PromptSuggestions.tsx` — the component
- `landing.css` — the layout rules that went with it (left-aligned greeting on
  desktop, full-width welcome block on mobile). Without these the greeting is
  centered, which is upstream's look but leaves the suggestion list visually
  detached from the heading.

Both files live **outside** `client/src`, so they are not compiled, linted, or
type-checked. They are a snapshot, not live code — the imports
(`~/utils`, `~/store`, `~/Providers`, `~/common`) and the Tailwind class-string
selectors in `landing.css` may have drifted upstream since parking. The CSS
selectors in particular are brittle: they match Landing's exact generated class
lists, so re-check them against the current `Landing.tsx` markup.

Origin commit: `b0e4d8af4` (feat: Integrate PromptSuggestions component, #5).

## Re-applying

1. Move the component back:

   ```bash
   git mv .fork/parked/landing-prompt-suggestions/PromptSuggestions.tsx \
     client/src/forked-code-custom/PromptSuggestions.tsx
   ```

2. `client/src/forked-code-custom/index.ts` — re-add the import and the export
   entry:

   ```ts
   import { PromptSuggestions } from './PromptSuggestions';
   ```

3. `client/src/forked-code-custom/jestBarrelStub.tsx` — re-add the stub export,
   and add `Landing` back to the list of wired components in the docstring:

   ```ts
   export const PromptSuggestions = () => null;
   ```

4. `client/src/components/Chat/Landing.tsx` — three edits. Import:

   ```ts
   import { PromptSuggestions } from '~/forked-code-custom';
   ```

   Inside `getDynamicMargin`, immediately before `return margin;`:

   ```ts
   // FORK-SENTINEL:landing-suggestions-margin — extra bottom margin so PromptSuggestions clears the input
   if (contentHeight > 334) {
     margin = 'mb-28';
     if (window.innerWidth < 640) {
       margin = 'mb-0';
     }
   }
   ```

   As the last child of the `contentRef` wrapper, after the `selectedAgent`
   block:

   ```tsx
   {/* FORK-SENTINEL:prompt-suggestions — fork-only starter prompt suggestions on the landing screen */}
   <PromptSuggestions />
   ```

5. Re-add both rows to `.fork/sentinels.tsv` (TAB-separated):

   ```
   landing-suggestions-margin	client/src/components/Chat/Landing.tsx	Extra bottom margin so PromptSuggestions clears the input	mb-28
   prompt-suggestions	client/src/components/Chat/Landing.tsx	Fork-only starter prompt suggestions on the landing screen	<PromptSuggestions
   ```

6. Append the contents of `landing.css` back onto
   `client/src/forked-style-custom/custom-daniel-ai.css`. (The first rule there —
   the `form...sm\:mb-28` block — has a fully commented-out body and is inert;
   it is kept only as a record of what was tried.)

7. Verify: `bash .fork/verify-sentinels.sh` and
   `npx eslint client/src/forked-code-custom client/src/components/Chat/Landing.tsx`.

The removal commit is the other reference — `git log --diff-filter=D --
client/src/forked-code-custom/PromptSuggestions.tsx` finds it.
