import { toggleTheme } from './utils';

describe('toggleTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    window.lastThemeChange = undefined;
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    window.lastThemeChange = undefined;
  });

  it('toggles the scheme without resetting the contrast control timestamp', () => {
    localStorage.setItem('color-theme', 'dark');
    document.documentElement.classList.add('dark');
    window.lastThemeChange = { scheme: 100, contrast: 200 };
    jest.spyOn(Date, 'now').mockReturnValue(300);

    expect(toggleTheme()).toBe('light');
    expect(localStorage.getItem('color-theme')).toBe('light');
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(window.lastThemeChange).toEqual({ scheme: 300, contrast: 200 });
  });

  it('initializes scheme tracking when no appearance control has changed', () => {
    jest.spyOn(Date, 'now').mockReturnValue(400);

    expect(toggleTheme()).toBe('dark');
    expect(window.lastThemeChange).toEqual({ scheme: 400 });
  });
});
