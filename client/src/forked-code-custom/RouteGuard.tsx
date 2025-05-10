import { useState, useEffect, ReactNode, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthContext } from '~/hooks/AuthContext';
import { fetchSubscriptionStatus } from './utils';
import SubscriptionRequiredPage from './SubscriptionRequiredPage';

type CheckStatus = 'pending' | 'access-granted' | 'subscription-required' | 'error'

type RouteGuardProps = {
  children: ReactNode
}

const publicPaths = [
  '/login',
  '/register',
  '/login/2fa',
  '/forgot-password',
  '/reset-password',
  '/verify',
];

/**
 * RouteGuard combines authentication and subscription checks by calling the API
 * for the current subscription status. It only renders children when the auth details
 * and subscription check are complete.
 */
const RouteGuard = ({ children }: RouteGuardProps) => {
  const { user, isAuthenticated, logout } = useAuthContext();
  const location = useLocation();
  const [checkStatus, setCheckStatus] = useState<CheckStatus>('pending');
  const [isCheckComplete, setIsCheckComplete] = useState(false);
  const [isRechecking, setIsRechecking] = useState(false);

  const isPublicPath = publicPaths.some(path =>
    location.pathname.startsWith(path)
  );

  // Subscription API Check Logic (no caching in localStorage)
  const performSubscriptionCheck = useCallback(
    async (userId: string, email?: string) => {
      console.log('[RouteGuard Async] Starting API check...');
      try {
        const data = await fetchSubscriptionStatus(userId, email);
        console.log('[RouteGuard Async] API result:', data);
        let finalStatus: CheckStatus;

        if (data.error && !data.fallback) {
          finalStatus = 'error';
        } else {
          const accessGranted =
            data.hasSubscription || data.whitelisted || data.fallback;
          finalStatus = accessGranted ? 'access-granted' : 'subscription-required';
        }

        setCheckStatus(finalStatus);
        setIsCheckComplete(true);
      } catch (fetchError) {
        console.error('[RouteGuard Async] API fetch error:', fetchError);
        setCheckStatus('error');
        setIsCheckComplete(true);
      } finally {
        setIsRechecking(false);
      }
    },
    []
  );

  // Triggered manually from SubscriptionRequiredPage to recheck subscription
  const handleRecheckSubscription = useCallback(() => {
    if (!user?.id) {
      console.error('[RouteGuard Recheck] Cannot recheck without user ID.');
      return;
    }
    console.log('[RouteGuard Recheck] Initiating recheck...');
    setIsRechecking(true);
    performSubscriptionCheck(user.id, user.email);
  }, [user?.id, user?.email, performSubscriptionCheck]);

  useEffect(() => {
    let isMounted = true;
    // Reset state on dependency changes
    setIsCheckComplete(false);
    setCheckStatus('pending');

    if (isPublicPath) {
      console.log('[RouteGuard] Public path.');
      setCheckStatus('access-granted');
      setIsCheckComplete(true);
    } else if (!isAuthenticated) {
      console.log('[RouteGuard] Unauthenticated.');
      setCheckStatus('access-granted');
      setIsCheckComplete(true);
    } else if (isAuthenticated && !user?.id) {
      console.log('[RouteGuard] Authenticated but waiting for user ID.');
      // Remains pending until user data is available
    } else if (isAuthenticated && user?.id) {
      console.log('[RouteGuard] Authenticated with user ID. Checking subscription via API...');
      performSubscriptionCheck(user.id, user.email).then(() => {
        // Optionally, check if still mounted before proceeding
        if (!isMounted) {
          return null;
        }
      });
    }
    return () => {
      isMounted = false;
    };
  }, [user?.id, user?.email, isAuthenticated, location.pathname, isPublicPath, performSubscriptionCheck]);

  // Rendering logic: show nothing until auth and subscription check are complete
  if (isPublicPath) {
    return <>{children}</>;
  }

  if (!isAuthenticated || !user?.id || !isCheckComplete) {
    return null;
  }

  if (checkStatus === 'access-granted') {
    return <>{children}</>;
  } else if (checkStatus === 'subscription-required' || checkStatus === 'error') {
    return (
      <SubscriptionRequiredPage
        onLogout={() => logout('/login?redirect=false')}
        error={checkStatus === 'error'}
        onRecheck={handleRecheckSubscription}
        isLoading={isRechecking}
      />
    );
  } else {
    console.error('[RouteGuard Render] Unexpected state: Check complete but status is pending.');
    return null;
  }
};

export default RouteGuard;