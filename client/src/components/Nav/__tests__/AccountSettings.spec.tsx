import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor } from '../../../../test/layout-test-utils';
import AccountSettings from '../AccountSettings';

const mockShowToast = jest.fn();
const mockGetCustomerPortalUrl = jest.fn();
const mockUseAuthContext = jest.fn();

jest.mock('@ariakit/react/menu', () => ({
  MenuProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MenuButton: (jest.requireActual('react') as typeof import('react')).forwardRef(
    (
      { children, ...props }: React.ComponentProps<'button'>,
      ref: React.ForwardedRef<HTMLButtonElement>,
    ) => (
      <button ref={ref} type="button" {...props}>
        {children}
      </button>
    ),
  ),
  Menu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MenuItem: ({ children, ...props }: React.ComponentProps<'button'>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

jest.mock('@librechat/client', () => ({
  Avatar: () => <div data-testid="avatar" />,
  DropdownMenuSeparator: () => <div data-testid="separator" />,
  GearIcon: () => <span data-testid="gear-icon" />,
  LinkIcon: () => <span data-testid="link-icon" />,
  useToastContext: () => ({
    showToast: mockShowToast,
  }),
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({
    data: {
      helpAndFaqURL: '/',
      balance: {
        enabled: false,
      },
    },
  }),
  useGetUserBalance: () => ({
    data: null,
  }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) =>
    (
      ({
        com_nav_account_settings: 'Account settings',
        com_nav_settings: 'Settings',
        com_nav_my_files: 'My Files',
        com_nav_log_out: 'Log out',
        com_nav_user: 'User',
        com_nav_profile: 'Profile',
      }) as Record<string, string>
    )[key] ?? key,
}));

jest.mock('~/hooks/AuthContext', () => ({
  useAuthContext: () => mockUseAuthContext(),
  AuthContextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('~/components/Chat/Input/Files/MyFilesModal', () => ({
  MyFilesModal: () => null,
}));

jest.mock('../Settings', () => () => null);

jest.mock('~/forked-code-custom/customerPortal', () => ({
  getCustomerPortalUrl: (...args: unknown[]) => mockGetCustomerPortalUrl(...args),
}));

describe('AccountSettings', () => {
  const windowOpen = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuthContext.mockReturnValue({
      user: {
        name: 'Portal User',
        email: 'person@example.com',
      },
      isAuthenticated: true,
      logout: jest.fn(),
    });
    window.open = windowOpen;
  });

  it('opens the customer portal URL in a new window when Profile is clicked', async () => {
    const mockNewWindow = { opener: null, location: { href: '' }, close: jest.fn() };
    windowOpen.mockReturnValue(mockNewWindow);

    mockGetCustomerPortalUrl.mockResolvedValue(
      'https://profile.danieldjupvik.com/?token=jwt-token',
    );

    render(<AccountSettings />);

    await userEvent.click(screen.getByRole('button', { name: 'Profile' }));

    await waitFor(() => {
      expect(mockGetCustomerPortalUrl).toHaveBeenCalledTimes(1);
    });

    // Blank tab opened synchronously to satisfy popup-blocker rules
    expect(windowOpen).toHaveBeenCalledWith('about:blank', '_blank');
    expect(mockNewWindow.opener).toBeNull();
    expect(mockNewWindow.location.href).toBe(
      'https://profile.danieldjupvik.com/?token=jwt-token',
    );
  });

  it('does not generate a portal URL when the current user has no email', async () => {
    mockUseAuthContext.mockReturnValue({
      user: {
        name: 'Portal User',
        email: '',
      },
      isAuthenticated: true,
      logout: jest.fn(),
    });

    render(<AccountSettings />);

    const profileButton = screen.getByRole('button', { name: 'Profile' });

    expect(profileButton).toBeDisabled();

    await userEvent.click(profileButton);

    expect(mockGetCustomerPortalUrl).not.toHaveBeenCalled();
    expect(windowOpen).not.toHaveBeenCalled();
  });
});
