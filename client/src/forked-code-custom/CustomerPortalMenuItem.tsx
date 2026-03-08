import { useState } from 'react';
import copy from 'copy-to-clipboard';
import * as Menu from '@ariakit/react/menu';
import { User } from 'lucide-react';
import { TooltipAnchor, useToastContext } from '@librechat/client';
import { getCustomerPortalUrl } from './customerPortal';

type CustomerPortalMenuItemProps = {
  email?: string;
};

export default function CustomerPortalMenuItem({ email }: CustomerPortalMenuItemProps) {
  const { showToast } = useToastContext();
  const [isOpeningProfile, setIsOpeningProfile] = useState(false);
  const canOpenProfile = Boolean(email?.trim());
  const modifierKey = /mac|iphone|ipad/i.test(navigator.userAgent) ? '⌘' : 'Ctrl';

  const handleProfileClick = async (event: React.MouseEvent) => {
    if (!canOpenProfile) {
      showToast({
        message: 'Your account needs an email address before opening the customer portal.',
        status: 'error',
      });
      return;
    }

    const wantsCopy = event.metaKey || event.ctrlKey;

    // Only open a tab when not copying — avoids a blank tab flash
    const newWindow = wantsCopy ? null : window.open('about:blank', '_blank');

    try {
      setIsOpeningProfile(true);
      const url = await getCustomerPortalUrl();

      if (wantsCopy) {
        if (copy(url)) {
          showToast({ message: 'Portal link copied to clipboard', status: 'success' });
        } else {
          showToast({ message: 'Unable to copy — opening portal instead', status: 'warning' });
          window.open(url, '_blank', 'noopener,noreferrer');
        }
        return;
      }

      if (newWindow) {
        newWindow.opener = null;
        newWindow.location.href = url;
      } else {
        window.location.href = url;
      }
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Unable to open the customer portal right now.';

      newWindow?.close();
      showToast({ message, status: 'error' });
    } finally {
      setIsOpeningProfile(false);
    }
  };

  return (
    <TooltipAnchor
      description={`${modifierKey}+click to copy link`}
      side="left"
      render={
        <Menu.MenuItem
          onClick={handleProfileClick}
          disabled={isOpeningProfile || !canOpenProfile}
          className="select-item text-sm"
        />
      }
    >
      <User className="icon-md" />
      {'Profile'}
    </TooltipAnchor>
  );
}
