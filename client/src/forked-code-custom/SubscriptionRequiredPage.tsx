import React, { useEffect, useState } from 'react';
import {
  Loader2,
  CreditCard,
  ShieldCheck,
  AlertCircle,
  LockKeyhole,
  ArrowRight,
  RefreshCw,
  Sparkles,
} from 'lucide-react';

// Text constants to avoid ESLint literal string warnings
const TEXT = {
  errorTitle: 'Connection Issue',
  errorMessage: 'We encountered a problem verifying your subscription status. Please try again or contact support if the issue persists.',
  tryAgain: 'Try Again',
  logout: 'Logout',
  needHelp: 'Need help? Contact',
  supportEmail: 'support@danieldjupvik.com',
  supportEmailHref: 'sockets.might-9b@icloud.com',
  unlockAccess: 'Unlock Full Access',
  subscriptionInfo: 'To get access to this premium service, you need to activate your subscription. Our pay-as-you-go model ensures you only pay for what you use.',
  stripeInfo: 'Our payment system is powered by Stripe, ensuring your payment information is secure and protected.',
  accessStatus: 'Access Status',
  statusInfo: 'Your subscription is currently inactive. You can check again to verify your access status.',
  verifyStatus: 'Verify Access Status',
  features: {
    payAsYouGo: {
      title: 'Pay As You Go',
      desc: 'Only pay for what you use with no monthly commitments',
    },
    processingFee: {
      title: 'Minimal Processing Fee',
      desc: 'Only 2.9% + $0.30 per transaction via Stripe',
    },
    premiumSupport: {
      title: 'Premium AI Models',
      desc: 'Access to premium AI models as soon as possible',
    },
  },
};

// Minimum loading time in milliseconds to ensure users notice the loading state
const MIN_LOADING_TIME = 1000;

// Define the props type for the component
type SubscriptionRequiredPageProps = {
  onLogout: () => void;
  error?: boolean;
  onRecheck: () => void;
  isLoading?: boolean;
};

/**
 * Modern page shown to users who are authenticated but lack an active subscription
 * or encountered an error during the subscription check.
 */
const SubscriptionRequiredPage = ({
  onLogout,
  error = false,
  onRecheck,
  isLoading = false,
}: SubscriptionRequiredPageProps) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isLocalLoading, setIsLocalLoading] = useState(false);

  useEffect(() => {
    // First set to false to ensure we start with hidden state
    setIsVisible(false);

    // Then set a small delay before showing to ensure animation triggers properly
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, 50); // Small delay to ensure the initial render is complete

    return () => clearTimeout(timer);
  }, []);

  // Handle loading state with minimum duration
  const handleRecheck = () => {
    setIsLocalLoading(true);

    // Call the actual recheck function
    onRecheck();

    // Set up a timer to ensure minimum loading time
    setTimeout(() => {
      setIsLocalLoading(false);
    }, MIN_LOADING_TIME);
  };

  // Combined loading state (either from props or local state)
  const combinedLoading = isLoading || isLocalLoading;

  // Reset local loading state when props loading state changes to false
  useEffect(() => {
    if (!isLoading && isLocalLoading) {
      const timerId = setTimeout(() => {
        setIsLocalLoading(false);
      }, MIN_LOADING_TIME);

      return () => clearTimeout(timerId);
    }
  }, [isLoading, isLocalLoading]);

  const content = error ? (
    <ErrorView
      onLogout={onLogout}
      onRecheck={handleRecheck}
      isLoading={combinedLoading}
      isVisible={isVisible}
    />
  ) : (
    <SubscriptionView
      onLogout={onLogout}
      onRecheck={handleRecheck}
      isLoading={combinedLoading}
      isVisible={isVisible}
    />
  );

  return (
    <div className="h-full flex items-center justify-center self-center">
      {content}
    </div>
  );
};

const ErrorView = ({
  onLogout,
  onRecheck,
  isLoading,
  isVisible,
}: {
  onLogout: () => void;
  onRecheck: () => void;
  isLoading: boolean;
  isVisible: boolean;
}) => {
  return (
    <div
      id="error-card"
      className={`flex flex-col justify-center w-full h-full sm:h-auto sm:max-w-lg rounded-none sm:rounded-lg bg-surface-primary-alt bg-gradient-to-br from-[#3bd5b0]/5 via-transparent to-[#3bd5b0]/10 border border-border-light p-6 md:p-10 shadow-lg sm:mx-4 transition-all duration-700 ease-out transform ${
        isVisible
          ? 'opacity-100 translate-y-0 scale-100'
          : 'opacity-0 translate-y-8 scale-95'
      }`}
      style={{ willChange: 'opacity, transform' }}
    >
      <div className="flex flex-col max-w-5xl mx-auto w-full">
        <div className="mx-auto mb-6 md:mb-8 flex items-center justify-center">
          <div className="rounded-full bg-surface-destructive/20 p-3">
            <AlertCircle size={32} className="text-surface-destructive" />
          </div>
        </div>

        <h2 className="mb-4 md:mb-6 text-center text-2xl font-bold text-text-primary">{TEXT.errorTitle}</h2>

        <p className="mb-8 md:mb-10 text-center text-text-secondary">
          {TEXT.errorMessage}
        </p>

        <div className="space-y-3 sm:space-y-0 sm:flex sm:justify-center sm:gap-4">
          <button
            type="button"
            onClick={onRecheck}
            disabled={isLoading}
            className="w-full sm:w-auto inline-flex items-center justify-center rounded-md bg-[#3bd5b0] px-4 py-2 text-surface-primary-alt hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-[#3bd5b0]/50 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200"
            aria-label="Retry checking subscription status"
            aria-disabled={isLoading}
          >
            {isLoading ? (
              <Loader2 size={16} className="mr-3 animate-spin" />
            ) : (
              <RefreshCw size={16} className="mr-3" />
            )}
            {TEXT.tryAgain}
          </button>

          <button
            onClick={onLogout}
            className="w-full sm:w-auto inline-flex items-center justify-center rounded-md border border-border-light bg-surface-secondary px-4 py-2 text-secondary-foreground/90 hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 transition-all duration-200"
            tabIndex={0}
            aria-label="Logout"
            onKeyDown={(e) => e.key === 'Enter' && onLogout()}
          >
            {TEXT.logout}
          </button>
        </div>

        <div className="mt-6 md:mt-8">
          <div className="rounded-lg p-4 md:p-6 border border-border-light bg-surface-tertiary">
            <div className="flex items-center gap-3">
              <ShieldCheck size={25} className="text-[#3bd5b0] flex-shrink-0" />
              <p className="text-sm text-text-secondary">
                {TEXT.stripeInfo}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const SubscriptionView = ({
  onLogout,
  onRecheck,
  isLoading,
  isVisible,
}: {
  onLogout: () => void;
  onRecheck: () => void;
  isLoading: boolean;
  isVisible: boolean;
}) => {
  // Darker green accent color for better contrast
  const accentColor = '#3bd5b0';

  const features = [
    {
      title: TEXT.features.payAsYouGo.title,
      description: TEXT.features.payAsYouGo.desc,
      icon: <CreditCard className={`h-5 w-5 text-[${accentColor}]`} />,
    },
    {
      title: TEXT.features.processingFee.title,
      description: TEXT.features.processingFee.desc,
      icon: <ShieldCheck className={`h-5 w-5 text-[${accentColor}]`} />,
    },
    {
      title: TEXT.features.premiumSupport.title,
      description: TEXT.features.premiumSupport.desc,
      icon: <LockKeyhole className={`h-5 w-5 text-[${accentColor}]`} />,
    },
  ];

  return (
    <div
      id="subscription-card"
      className={`flex flex-col justify-center w-full h-full sm:h-auto sm:max-w-3xl md:max-w-4xl rounded-none sm:rounded-lg bg-surface-primary-alt bg-gradient-to-br from-[#3bd5b0]/5 via-transparent to-[#3bd5b0]/10 border border-border-light p-6 md:p-10 shadow-lg sm:mx-4 transition-all duration-700 ease-out transform ${
        isVisible
          ? 'opacity-100 translate-y-0 scale-100'
          : 'opacity-0 translate-y-8 scale-95'
      }`}
      style={{ willChange: 'opacity, transform' }}
    >
      <div className="flex flex-col md:flex-row max-w-5xl mx-auto w-full">
        {/* Left column - Information */}
        <div className="flex flex-col flex-1 md:pr-10">
          <div className="mb-6 md:mb-8 flex items-center space-x-2">
            <div className="rounded-full bg-[#3bd5b0]/20 p-2">
              <Sparkles className="h-6 w-6 text-[#3bd5b0]" />
            </div>
            <h2 className="text-2xl font-bold text-text-primary">{TEXT.unlockAccess}</h2>
          </div>

          <p className="text-text-secondary mb-8 md:mb-10">
            {TEXT.subscriptionInfo}
          </p>

          <div className="space-y-6 md:space-y-8 mb-8 md:mb-10">
            {features.map((feature, index) => (
              <div
                key={index}
                className={`flex items-start transition-all duration-700 ease-out transform ${
                  isVisible
                    ? 'opacity-100 translate-x-0'
                    : 'opacity-0 translate-x-8'
                }`}
                style={{
                  transitionDelay: `${300 + index * 150}ms`,
                  willChange: 'opacity, transform',
                }}
              >
                <div className="mt-1 mr-3 flex-shrink-0">
                  {feature.icon}
                </div>
                <div>
                  <h3 className="font-medium text-text-primary">{feature.title}</h3>
                  <p className="text-sm text-text-secondary">{feature.description}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Right column - Actions */}
          <div className="md:hidden flex flex-col mb-6">
            <div
              className={`bg-surface-chat p-5 rounded-lg mb-4 border border-border-light transition-all duration-700 ease-out transform ${
                isVisible
                  ? 'opacity-100 translate-y-0 scale-100'
                  : 'opacity-0 translate-y-8 scale-95'
              }`}
              style={{
                transitionDelay: '500ms',
                willChange: 'opacity, transform',
              }}
            >
              <h3 className="font-medium text-text-primary mb-2">{TEXT.accessStatus}</h3>
              <p className="text-sm text-text-secondary mb-6">
                {TEXT.statusInfo}
              </p>

              <button
                type="button"
                onClick={onRecheck}
                disabled={isLoading}
                className="w-full inline-flex items-center justify-center rounded-md bg-[#3bd5b0] px-4 py-2 text-surface-primary-alt hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-[#3bd5b0]/50 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200 mb-3"
                aria-label="Recheck subscription status"
                aria-disabled={isLoading}
              >
                {isLoading ? (
                  <Loader2 className="mr-3 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-3 h-4 w-4" />
                )}
                {TEXT.verifyStatus}
              </button>

              <button
                onClick={onLogout}
                className="w-full inline-flex items-center justify-center rounded-md border border-border-light bg-surface-secondary px-4 py-2 text-secondary-foreground/90 hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 transition-all duration-200"
                tabIndex={0}
                aria-label="Logout"
                onKeyDown={(e) => e.key === 'Enter' && onLogout()}
              >
                {TEXT.logout}
              </button>
            </div>
          </div>

          <div
            className={`rounded-lg p-4 md:p-6 border border-border-light bg-surface-tertiary md:mb-0 transition-all duration-700 ease-out transform ${
              isVisible
                ? 'opacity-100 translate-y-0'
                : 'opacity-0 translate-y-8'
            }`}
            style={{
              transitionDelay: '600ms',
              willChange: 'opacity, transform',
            }}
          >
            <div className="flex items-center gap-3">
              <ShieldCheck size={25} className="text-[#3bd5b0] flex-shrink-0" />
              <p className="text-sm text-text-secondary">
                {TEXT.stripeInfo}
              </p>
            </div>
          </div>
        </div>

        {/* Desktop Actions Column */}
        <div className="hidden md:flex md:w-80 flex-col md:pl-10 md:border-l border-border-light">
          <div
            className={`bg-surface-chat p-5 rounded-lg mb-4 border border-border-light transition-all duration-700 ease-out transform ${
              isVisible
                ? 'opacity-100 translate-y-0 scale-100'
                : 'opacity-0 translate-y-8 scale-95'
            }`}
            style={{
              transitionDelay: '500ms',
              willChange: 'opacity, transform',
            }}
          >
            <h3 className="font-medium text-text-primary mb-2">{TEXT.accessStatus}</h3>
            <p className="text-sm text-text-secondary mb-6">
              {TEXT.statusInfo}
            </p>

            <button
              type="button"
              onClick={onRecheck}
              disabled={isLoading}
              className="w-full inline-flex items-center justify-center rounded-md bg-[#3bd5b0] px-4 py-2 text-surface-primary-alt hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-[#3bd5b0]/50 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200 mb-3"
              aria-label="Recheck subscription status"
              aria-disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 className="mr-3 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-3 h-4 w-4" />
              )}
              {TEXT.verifyStatus}
            </button>

            <button
              onClick={onLogout}
              className="w-full inline-flex items-center justify-center rounded-md border border-border-light bg-surface-secondary px-4 py-2 text-secondary-foreground/90 hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 transition-all duration-200"
              tabIndex={0}
              aria-label="Logout"
              onKeyDown={(e) => e.key === 'Enter' && onLogout()}
            >
              {TEXT.logout}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SubscriptionRequiredPage;