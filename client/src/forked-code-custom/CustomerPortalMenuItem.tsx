import { useState } from 'react';
import * as Menu from '@ariakit/react/menu';
import { User } from 'lucide-react';
import { useToastContext } from '@librechat/client';
import { getCustomerPortalUrl } from './customerPortal';

type CustomerPortalMenuItemProps = {
  email?: string;
};

export default function CustomerPortalMenuItem({ email }: CustomerPortalMenuItemProps) {
  const { showToast } = useToastContext();
  const [isOpeningProfile, setIsOpeningProfile] = useState(false);
  const canOpenProfile = Boolean(email?.trim());

  const handleProfileClick = async () => {
    if (!canOpenProfile) {
      showToast({
        message: 'Your account needs an email address before opening the customer portal.',
        status: 'error',
      });
      return;
    }

    // Open the tab synchronously so the click gesture satisfies popup-blocker rules
    const newWindow = window.open('about:blank', '_blank');

    try {
      setIsOpeningProfile(true);
      const url = await getCustomerPortalUrl();

      if (newWindow) {
        newWindow.opener = null;
        newWindow.location.href = url;
      } else {
        window.location.href = url;
      }
    } catch (error) {
      newWindow?.close();

      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Unable to open the customer portal right now.';

      showToast({ message, status: 'error' });
    } finally {
      setIsOpeningProfile(false);
    }
  };

  return (
    <Menu.MenuItem
      onClick={handleProfileClick}
      disabled={isOpeningProfile || !canOpenProfile}
      className="select-item text-sm"
    >
      <User className="icon-md" />
      {'Profile'}
    </Menu.MenuItem>
  );
}
