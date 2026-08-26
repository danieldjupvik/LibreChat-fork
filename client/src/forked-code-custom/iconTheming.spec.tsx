import React from 'react';
import fs from 'fs';
import path from 'path';
import { render } from '@testing-library/react';
import MessageRow from '~/components/Chat/Messages/ui/MessageRow';
import ConvoIconURL from '~/components/Endpoints/ConvoIconURL';

/**
 * Guards the fork's `iconURL` SVG theming rule in
 * `client/src/forked-style-custom/custom-daniel-ai.css`.
 *
 * That rule makes provider icons follow the theme (black in light, white in
 * dark) by filtering them, because lobehub-style icons use
 * `fill="currentColor"` and an SVG loaded through `<img>` cannot inherit the
 * page's color — it resolves to black in both themes.
 *
 * The rule can only find those images through upstream's Tailwind classes, so
 * an upstream refactor of the icon frame silently un-themes them. That is not
 * hypothetical: upstream #14770 changed the message header's frame from a
 * `div` to a `span`, and because the rule was written `div.rounded-full ...`
 * the in-chat icon rendered black in dark mode for 11 days before anyone
 * noticed.
 *
 * So this test deliberately does NOT hardcode markup. It reads the selectors
 * out of the real CSS file and matches them against the DOM that the real
 * components render. Either side drifting fails the test.
 */

const CSS_PATH = path.resolve(__dirname, '../forked-style-custom/custom-daniel-ai.css');
const SVG_ICON = 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/claude.svg';

/** Selector lines of the icon-theming rules, read from the stylesheet itself. */
function readIconSelectors(): { light: string; dark: string } {
  const css = fs.readFileSync(CSS_PATH, 'utf8');
  const selectors = [...css.matchAll(/^([^{}\n]*img\.object-cover\[[^{}\n]*)\s*\{/gm)].map((m) =>
    m[1].trim(),
  );

  const dark = selectors.filter((s) => s.startsWith('.dark'));
  const light = selectors.filter((s) => !s.startsWith('.dark'));

  if (light.length !== 1 || dark.length !== 1) {
    throw new Error(
      `Expected exactly one light and one dark icon rule in ${CSS_PATH}, found ` +
        `${light.length} light and ${dark.length} dark: ${JSON.stringify(selectors)}`,
    );
  }

  return { light: light[0]!, dark: dark[0]! };
}

/** Renders inside a `.dark` ancestor so the dark-mode selector can match. */
function renderThemed(ui: React.ReactElement): HTMLDivElement {
  const host = document.createElement('div');
  host.className = 'dark';
  document.body.appendChild(host);
  const container = document.createElement('div');
  host.appendChild(container);
  render(ui, { container });
  return container;
}

/** The real in-chat header: upstream's MessageRow frame around the real icon. */
const messageHeader = (): React.ReactElement => (
  <MessageRow
    label="Claude"
    isCreatedByUser={false}
    icon={<ConvoIconURL iconURL={SVG_ICON} context="message" />}
    footer={null}
  >
    <div />
  </MessageRow>
);

const surfaces: Array<[string, () => React.ReactElement]> = [
  ['message header (MessageRow frame)', messageHeader],
  ['model selector row', () => <ConvoIconURL iconURL={SVG_ICON} context="menu-item" />],
  ['landing / nav', () => <ConvoIconURL iconURL={SVG_ICON} context="landing" />],
];

describe('fork iconURL SVG theming', () => {
  const { light, dark } = readIconSelectors();

  it('reads both rules from the stylesheet', () => {
    expect(light).toContain('img.object-cover');
    expect(dark.startsWith('.dark')).toBe(true);
  });

  it.each(surfaces)('themes the icon on the %s', (_name, ui) => {
    const container = renderThemed(ui());
    const img = container.querySelector('img');

    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe(SVG_ICON);
    expect(img!.matches(light)).toBe(true);
    expect(img!.matches(dark)).toBe(true);
  });

  /**
   * The specific shape of the #14770 regression: a rule qualified by the
   * frame's tag name. Kept as an explicit guard so the rule is not "tightened"
   * back into a tag-qualified selector without this failing.
   */
  it('does not depend on the icon frame being a particular element', () => {
    const container = renderThemed(messageHeader());
    const img = container.querySelector('img')!;

    expect(img.closest('div.rounded-full')).toBeNull();
    expect(img.closest('.rounded-full')).not.toBeNull();
    expect(light).not.toMatch(/\b(div|span)\.rounded-full/);
  });
});
