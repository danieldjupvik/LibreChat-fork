import { useState, useEffect, ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthContext } from '~/hooks/AuthContext';
import { fetchSubscriptionStatus } from './utils';
import SubscriptionRequiredPage from './SubscriptionRequiredPage';

// Refined status: pending = initial/checking, final statuses = granted/required/error
// isCheckComplete tracks if we have a definitive answer (from cache or API)
type CheckStatus = 'pending' | 'access-granted' | 'subscription-required' | 'error';

type RouteGuardProps = {
  children: ReactNode;
};

// Login and registration paths that shouldn't be blocked
const publicPaths = ['/login', '/register', '/login/2fa', '/forgot-password', '/reset-password', '/verify'];

/**
 * RouteGuard combines authentication and subscription checks using an optimistic rendering approach.
 * It renders children immediately for authenticated users and only shows the
 * subscription required page after a check explicitly denies access.
 */
const RouteGuard = ({ children }: RouteGuardProps) => {
  const { user, isAuthenticated, logout } = useAuthContext();
  const location = useLocation();
  // Start as pending, check is not complete
  const [checkStatus, setCheckStatus] = useState<CheckStatus>('pending');
  const [isCheckComplete, setIsCheckComplete] = useState(false);

  const isPublicPath = publicPaths.some(path => location.pathname.startsWith(path));

  useEffect(() => {
    // Reset on dependency change
    setIsCheckComplete(false);
    setCheckStatus('pending');

    let needsAsyncCheck = false;
    let immediateStatus: CheckStatus | null = null;
    let currentUserId: string | undefined = undefined;
    let currentUserEmail: string | undefined = undefined;

    // --- Determine immediate action based on sync info ---

    if (isPublicPath) {
      immediateStatus = 'access-granted';
      console.log('[RouteGuard Optimistic] Public path.');
    } else if (!isAuthenticated) {
      immediateStatus = 'access-granted'; // Assume access, let router redirect
      console.log('[RouteGuard Optimistic] Unauthenticated.');
    } else if (isAuthenticated && !user?.id) {
      // Authenticated, but user details not ready yet. Stay pending.
      immediateStatus = 'pending';
      console.log('[RouteGuard Optimistic] Authenticated but waiting for user ID.');
    } else if (isAuthenticated && user?.id) {
      // Authenticated and user details available - check cache
      console.log('[RouteGuard Optimistic] Authenticated with user ID. Checking cache...');
      currentUserId = user.id;
      currentUserEmail = user.email;
      const cachedData = localStorage.getItem('subscription');
      if (cachedData) {
        try {
          const parsed = JSON.parse(cachedData);
          const cacheTime = parsed.timestamp || 0;
          if (parsed.userId === currentUserId && Date.now() - cacheTime < 3600000) {
            const accessGranted = parsed.data.hasSubscription || parsed.data.whitelisted;
            immediateStatus = accessGranted ? 'access-granted' : 'subscription-required';
            console.log(`[RouteGuard Optimistic] Cache determined status: ${immediateStatus}`);
          } else {
            console.log('[RouteGuard Optimistic] Cache stale/mismatched. Needs API.');
            localStorage.removeItem('subscription');
            immediateStatus = 'pending'; // Stay pending until API check
            needsAsyncCheck = true;
          }
        } catch (parseError) {
          console.error('[RouteGuard Optimistic] Error parsing cache. Needs API.', parseError);
          localStorage.removeItem('subscription');
          immediateStatus = 'pending'; // Stay pending until API check
          needsAsyncCheck = true;
        }
      } else {
        console.log('[RouteGuard Optimistic] No cache found. Needs API.');
        immediateStatus = 'pending'; // Stay pending until API check
        needsAsyncCheck = true;
      }
    }

    // --- Update State and Trigger Async ---

    if (immediateStatus !== null) {
      setCheckStatus(immediateStatus);
      // Mark check as complete only if we got a final answer synchronously
      if (immediateStatus === 'access-granted' || immediateStatus === 'subscription-required') {
        setIsCheckComplete(true);
      } else {
        setIsCheckComplete(false); // Explicitly false if pending or needs API
      }

      // Trigger async check only if needed AND we have the user details
      if (needsAsyncCheck && immediateStatus === 'pending' && currentUserId) {
        console.log('[RouteGuard Async] Starting API check (optimistic)...');

        const performSubscriptionCheck = async (userId: string, email?: string) => {
          try {
            const data = await fetchSubscriptionStatus(userId, email);
            console.log('[RouteGuard Async] API result:', data);
            let finalStatus: CheckStatus;
            if (data.error && !data.fallback) {
              finalStatus = 'error';
            } else {
              const accessGranted = data.hasSubscription || data.whitelisted || data.fallback;
              finalStatus = accessGranted ? 'access-granted' : 'subscription-required';
              // Update cache only on non-error API response
              localStorage.setItem('subscription', JSON.stringify({
                data: {
                  hasSubscription: data.hasSubscription,
                  whitelisted: data.whitelisted,
                  fallback: data.fallback,
                  error: data.error,
                  errorMessage: data.errorMessage,
                },
                timestamp: Date.now(),
                userId: userId,
              }));
            }
            setCheckStatus(finalStatus);
            setIsCheckComplete(true); // Mark check complete after API responds
          } catch (fetchError) {
            console.error('[RouteGuard Async] API fetch error:', fetchError);
            setCheckStatus('error');
            setIsCheckComplete(true); // Mark check complete even on fetch error
          }
        };
        performSubscriptionCheck(currentUserId, currentUserEmail);
      }
    }

    // Cleanup logic (minimal, as loader is removed)
    // return () => { /* ... potential future cleanup ... */ };

  }, [user?.id, user?.email, isAuthenticated, location.pathname, isPublicPath]);

  // --- Rendering Logic (Optimistic) ---

  // Always grant access for public paths or unauthenticated users (let router handle redirects)
  if (isPublicPath || !isAuthenticated) {
    return <>{children}</>;
  }

  // Authenticated users:
  if (!isCheckComplete) {
    // If the check (cache or API) is not yet complete, render children optimistically
    return <>{children}</>;
  } else {
    // Check is complete, render based on the final status
    if (checkStatus === 'access-granted') {
      return <>{children}</>;
    } else if (checkStatus === 'subscription-required' || checkStatus === 'error') {
      // Show subscription page only after check completes and denies access
      return <SubscriptionRequiredPage onLogout={() => logout('/login?redirect=false')} error={checkStatus === 'error'} />;
    } else {
      // Should ideally not happen if status is pending and check is complete
      console.error('[RouteGuard Render] Unexpected state: Check complete but status is pending.');
      return null;
    }
  }
};

export default RouteGuard;