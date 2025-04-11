import { useState, useEffect, ReactNode, useCallback } from 'react';
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
 * RouteGuard combines authentication and subscription checks using cache or API.
 * It renders children immediately for authenticated users and only shows the
 * subscription required page after a check explicitly denies access.
 */
const RouteGuard = ({ children }: RouteGuardProps) => {
  const { user, isAuthenticated, logout } = useAuthContext();
  const location = useLocation();
  const [checkStatus, setCheckStatus] = useState<CheckStatus>('pending');
  const [isCheckComplete, setIsCheckComplete] = useState(false);
  const [isRechecking, setIsRechecking] = useState(false); // <-- Add rechecking state

  const isPublicPath = publicPaths.some(path => location.pathname.startsWith(path));

  // --- Extracted API Check Logic ---
  const performSubscriptionCheck = useCallback(async (userId: string, email?: string) => {
    console.log('[RouteGuard Async] Starting API check...');
    // Note: We don't set isRechecking = true here, only in the manual handler
    try {
      const data = await fetchSubscriptionStatus(userId, email);
      console.log('[RouteGuard Async] API result:', data);
      let finalStatus: CheckStatus;
      if (data.error && !data.fallback) {
        finalStatus = 'error';
      } else {
        const accessGranted = data.hasSubscription || data.whitelisted || data.fallback;
        finalStatus = accessGranted ? 'access-granted' : 'subscription-required';
        if (finalStatus === 'access-granted' || finalStatus === 'subscription-required') {
          // Update cache only on non-error, definitive API response
          localStorage.setItem('subscription', JSON.stringify({
            data: {
              hasSubscription: data.hasSubscription,
              whitelisted: data.whitelisted,
              fallback: data.fallback, // Include fallback in cache decision logic?
              error: false, // Explicitly set error false on success
              errorMessage: null,
            },
            timestamp: Date.now(),
            userId: userId,
          }));
        } else {
          // Potentially clear cache on error? Or handle error state caching?
          // For now, we only cache non-error states that grant or deny access.
        }
      }
      setCheckStatus(finalStatus);
      setIsCheckComplete(true);
    } catch (fetchError) {
      console.error('[RouteGuard Async] API fetch error:', fetchError);
      setCheckStatus('error');
      setIsCheckComplete(true);
    } finally {
      setIsRechecking(false); // <-- Ensure rechecking stops after API call completes
    }
  }, []);

  // --- Recheck Logic ---
  const handleRecheckSubscription = useCallback(() => {
    if (!user?.id) {
      console.error('[RouteGuard Recheck] Cannot recheck without user ID.');
      return;
    }
    console.log('[RouteGuard Recheck] Clearing cache and initiating recheck...');
    setIsRechecking(true);
    localStorage.removeItem('subscription');
    // DO NOT set checkStatus to 'pending' or isCheckComplete to false here
    performSubscriptionCheck(user.id, user.email); // Trigger the check again
  }, [user?.id, user?.email, performSubscriptionCheck]);

  useEffect(() => {
    // Reset on dependency change
    setIsCheckComplete(false);
    setCheckStatus('pending');
    // setIsRechecking(false); // Ensure rechecking is false on navigation/auth changes

    let needsAsyncCheck = false;
    let immediateStatus: CheckStatus | null = null;
    let currentUserId: string | undefined = undefined;
    let currentUserEmail: string | undefined = undefined;

    // --- Determine immediate action based on sync info ---

    if (isPublicPath) {
      immediateStatus = 'access-granted';
      console.log('[RouteGuard] Public path.');
    } else if (!isAuthenticated) {
      immediateStatus = 'access-granted'; // Assume access, let router redirect
      console.log('[RouteGuard] Unauthenticated.');
    } else if (isAuthenticated && !user?.id) {
      // Authenticated, but user details not ready yet. Stay pending.
      immediateStatus = 'pending';
      console.log('[RouteGuard] Authenticated but waiting for user ID.');
    } else if (isAuthenticated && user?.id) {
      // Authenticated and user details available - check cache
      console.log('[RouteGuard] Authenticated with user ID. Checking cache...');
      currentUserId = user.id;
      currentUserEmail = user.email;
      const cachedData = localStorage.getItem('subscription');
      if (cachedData) {
        try {
          const parsed = JSON.parse(cachedData);
          const cacheTime = parsed.timestamp || 0;
          if (parsed.userId === currentUserId && Date.now() - cacheTime < 3600000) { // 1 hour cache
            // Check cache validity based on stored data
            if (parsed.data.error) {
              // Treat cached error as needing API check unless configured otherwise
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
            console.log('[RouteGuard] Cache stale/mismatched. Needs API.');
            localStorage.removeItem('subscription');
            immediateStatus = 'pending'; // Stay pending until API check
            needsAsyncCheck = true;
          }
        } catch (parseError) {
          console.error('[RouteGuard] Error parsing cache. Needs API.', parseError);
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
      if (immediateStatus === 'access-granted' || immediateStatus === 'subscription-required') {
        setIsCheckComplete(true);
      } else {
        setIsCheckComplete(false);
      }

      if (needsAsyncCheck && immediateStatus === 'pending' && currentUserId) {
        performSubscriptionCheck(currentUserId, currentUserEmail);
      }
    }

  }, [user?.id, user?.email, isAuthenticated, location.pathname, isPublicPath, performSubscriptionCheck]);

  // --- Rendering Logic  ---
  console.log(isCheckComplete, 'isCheckComplete');

  // Always render children for public paths
  if (isPublicPath) {
    return <>{children}</>;
  }

  // If the auth state isn't fully resolved (either not authenticated or missing user details),
  // or if the subscription check hasn't completed, don't render anything (or render a loader)
  if (!isAuthenticated || !user?.id || !isCheckComplete) {
    return null; // You could also render a spinner, e.g., <LoadingSpinner />
  }

  // Authenticated users, and the check is complete:
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