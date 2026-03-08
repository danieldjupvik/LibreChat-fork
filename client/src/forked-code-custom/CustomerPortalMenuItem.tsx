import { useState } from 'react';
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
  const canCopyToClipboard =
    typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function';
  const modifierKey = /mac|iphone|ipad/i.test(navigator.userAgent) ? '⌘' : 'Ctrl';

  const handleProfileClick = async (event: React.MouseEvent) => {
    if (!canOpenProfile) {
      showToast({
        message: 'Your account needs an email address before opening the customer portal.',
        status: 'error',
      });
      return;
    }

    const wantsCopy = (event.metaKey || event.ctrlKey) && canCopyToClipboard;

    if (wantsCopy) {
      // Call clipboard.write() synchronously within the click gesture so Safari
      // considers it user-activated. The blob data resolves later via the promise.
      const urlPromise = getCustomerPortalUrl();
      const item = new ClipboardItem({
        'text/plain': urlPromise.then((url) => new Blob([url], { type: 'text/plain' })),
      });

      try {
        setIsOpeningProfile(true);
        await navigator.clipboard.write([item]);
        showToast({ message: 'Portal link copied to clipboard', status: 'success' });
      } catch {
        showToast({
          message: 'Could not copy link. Click Profile again without holding the modifier key.',
          status: 'error',
        });
      } finally {
        setIsOpeningProfile(false);
      }
      return;
    }

    // Non-copy path: open tab synchronously to satisfy popup-blocker rules
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

  const menuItem = (
    <Menu.MenuItem
      onClick={handleProfileClick}
      disabled={isOpeningProfile || !canOpenProfile}
      className="select-item text-sm"
    >
      <User className="icon-md" />
      {'Profile'}
    </Menu.MenuItem>
  );

  if (!canCopyToClipboard) {
    return menuItem;
  }

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
