import { useState, useEffect, ReactNode, useCallback, useRef } from 'react';
import { useAuthContext } from '~/hooks/AuthContext';
import { fetchSubscriptionStatus } from './utils';
import SubscriptionRequiredPage from './SubscriptionRequiredPage';

type CheckStatus = 'pending' | 'access-granted' | 'subscription-required' | 'error';

export type DenialReason = 'no_account' | 'no_payment_method' | 'no_active_subscription' | null;

type RouteGuardProps = {
  children: ReactNode;
};

const publicPaths = [
  '/login',
  '/register',
  '/login/2fa',
  '/forgot-password',
  '/reset-password',
  '/verify',
];

/**
 * RouteGuard checks subscription status via API.
 * Optimistic: shows children immediately while check runs.
 * Only blocks if the API confirms no active subscription.
 */
const RouteGuard = ({ children }: RouteGuardProps) => {
  const { user, isAuthenticated, logout } = useAuthContext();
  const [checkStatus, setCheckStatus] = useState<CheckStatus>('pending');
  const [denialReason, setDenialReason] = useState<DenialReason>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [isRechecking, setIsRechecking] = useState(false);
  const checkedUserIdRef = useRef<string | null>(null);

  const performSubscriptionCheck = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await fetchSubscriptionStatus(signal);

      if (data.error && !data.fallback) {
        setCheckStatus('error');
        setDenialReason(null);
        setCheckoutUrl(null);
      } else {
        const accessGranted = data.hasSubscription || data.whitelisted || data.fallback;
        setCheckStatus(accessGranted ? 'access-granted' : 'subscription-required');
        setDenialReason(accessGranted ? null : (data.reason ?? 'no_active_subscription'));
        setCheckoutUrl(data.checkoutUrl ?? null);
      }
    } catch (_error) {
      // Aborted requests are expected during user switches — don't update state
      if (signal?.aborted) {
        return;
      }
      setCheckStatus('error');
      setDenialReason(null);
      setCheckoutUrl(null);
    } finally {
      if (!signal?.aborted) {
        setIsRechecking(false);
      }
    }
  }, []);

  const handleRecheckSubscription = useCallback(() => {
    setIsRechecking(true);
    performSubscriptionCheck();
  }, [performSubscriptionCheck]);

  // Reset ref when user logs out so re-login triggers a fresh check
  useEffect(() => {
    if (!isAuthenticated) {
      checkedUserIdRef.current = null;
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || !user?.id || checkedUserIdRef.current === user.id) {
      return;
    }

    const controller = new AbortController();
    checkedUserIdRef.current = user.id;
    setCheckStatus('pending');
    performSubscriptionCheck(controller.signal);

    return () => controller.abort();
  }, [user?.id, isAuthenticated, performSubscriptionCheck]);

  // Public paths and unauthenticated users pass through
  const isPublicPath = publicPaths.some((path) => window.location.pathname.startsWith(path));
  if (isPublicPath || !isAuthenticated || !user?.id) {
    return <>{children}</>;
  }

  // Optimistic: show children while check is pending or access is granted
  if (checkStatus === 'pending' || checkStatus === 'access-granted') {
    return <>{children}</>;
  }

  // Only block when API has confirmed no subscription or error
  return (
    <SubscriptionRequiredPage
      onLogout={() => logout('/login?redirect=false')}
      error={checkStatus === 'error'}
      onRecheck={handleRecheckSubscription}
      isLoading={isRechecking}
      denialReason={denialReason}
      checkoutUrl={checkoutUrl}
    />
  );
};

export default RouteGuard;
