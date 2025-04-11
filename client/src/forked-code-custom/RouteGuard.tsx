import { useState, useEffect, ReactNode, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthContext } from '~/hooks/AuthContext';
import { fetchSubscriptionStatus } from './utils';
import SubscriptionRequiredPage from './SubscriptionRequiredPage';

type CheckStatus = 'pending' | 'access-granted' | 'subscription-required' | 'error'

type RouteGuardProps = {
  children: ReactNode
}

// Paths that don't need blocking (e.g., login, registration, etc.)
const publicPaths = [
  '/login',
  '/register',
  '/login/2fa',
  '/forgot-password',
  '/reset-password',
  '/verify',
];

/**
 * RouteGuard combines authentication and subscription checks using cache or API.
 * It only renders children when the auth details and subscription check are complete.
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

  // Subscription API Check Logic
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
          finalStatus = accessGranted
            ? 'access-granted'
            : 'subscription-required';

          // Cache the API response if it provides a definitive status
          if (finalStatus === 'access-granted' || finalStatus === 'subscription-required') {
            localStorage.setItem(
              'subscription',
              JSON.stringify({
                data: {
                  hasSubscription: data.hasSubscription,
                  whitelisted: data.whitelisted,
                  fallback: data.fallback,
                  error: false,
                  errorMessage: null,
                },
                timestamp: Date.now(),
                userId,
              })
            );
          }
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

  // Triggered manually from the SubscriptionRequiredPage for rechecking
  const handleRecheckSubscription = useCallback(() => {
    if (!user?.id) {
      console.error('[RouteGuard Recheck] Cannot recheck without user ID.');
      return;
    }
    console.log('[RouteGuard Recheck] Clearing cache and initiating recheck...');
    setIsRechecking(true);
    localStorage.removeItem('subscription');
    performSubscriptionCheck(user.id, user.email);
  }, [user?.id, user?.email, performSubscriptionCheck]);

  useEffect(() => {
    // Reset state on dependency change
    setIsCheckComplete(false);
    setCheckStatus('pending');

    let needsAsyncCheck = false;
    let immediateStatus: CheckStatus | null = null;
    let currentUserId: string | undefined = undefined;
    let currentUserEmail: string | undefined = undefined;

    if (isPublicPath) {
      immediateStatus = 'access-granted';
      console.log('[RouteGuard] Public path.');
    } else if (!isAuthenticated) {
      immediateStatus = 'access-granted'; // Let router redirect unauthenticated user
      console.log('[RouteGuard] Unauthenticated.');
    } else if (isAuthenticated && !user?.id) {
      immediateStatus = 'pending';
      console.log('[RouteGuard] Authenticated but waiting for user ID.');
    } else if (isAuthenticated && user?.id) {
      console.log('[RouteGuard] Authenticated with user ID. Checking cache...');
      currentUserId = user.id;
      currentUserEmail = user.email;
      const cachedData = localStorage.getItem('subscription');

      if (cachedData) {
        try {
          const parsed = JSON.parse(cachedData);
          const cacheTime = parsed.timestamp || 0;
          if (parsed.userId === currentUserId && Date.now() - cacheTime < 3600000) {
            if (parsed.data.error) {
              console.log('[RouteGuard] Cache contains error. Needs API.');
              localStorage.removeItem('subscription');
              immediateStatus = 'pending';
              needsAsyncCheck = true;
            } else {
              const accessGranted = parsed.data.hasSubscription || parsed.data.whitelisted;
              immediateStatus = accessGranted ? 'access-granted' : 'subscription-required';
              console.log(`[RouteGuard] Cache determined status: ${immediateStatus}`);
            }
          } else {
            console.log('[RouteGuard] Cache stale or mismatched. Needs API.');
            localStorage.removeItem('subscription');
            immediateStatus = 'pending';
            needsAsyncCheck = true;
          }
        } catch (parseError) {
          console.error('[RouteGuard] Error parsing cache. Needs API.', parseError);
          localStorage.removeItem('subscription');
          immediateStatus = 'pending';
          needsAsyncCheck = true;
        }
      } else {
        console.log('[RouteGuard] No cache found. Needs API.');
        immediateStatus = 'pending';
        needsAsyncCheck = true;
      }
    }

    if (immediateStatus !== null) {
      setCheckStatus(immediateStatus);
      setIsCheckComplete(
        immediateStatus === 'access-granted' ||
          immediateStatus === 'subscription-required'
      );

      if (needsAsyncCheck && immediateStatus === 'pending' && currentUserId) {
        performSubscriptionCheck(currentUserId, currentUserEmail);
      }
    }
  }, [user?.id, user?.email, isAuthenticated, location.pathname, isPublicPath, performSubscriptionCheck]);

  console.log(isCheckComplete, 'isCheckComplete');

  // Rendering logic based on authentication and subscription check completion
  if (isPublicPath) {
    return <>{children}</>;
  }

  if (!isAuthenticated || !user?.id || !isCheckComplete) {
    return null; // Alternatively, you may return a loading spinner
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