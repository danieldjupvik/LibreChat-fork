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

  useEffect(() => {
    // Show animation immediately without delay
    setIsVisible(true);
  }, []);

  if (error) {
    return (
      <ErrorView
        onLogout={onLogout}
        onRecheck={onRecheck}
        isLoading={isLoading}
        isVisible={isVisible}
      />
    );
  }

  return (
    <SubscriptionView
      onLogout={onLogout}
      onRecheck={onRecheck}
      isLoading={isLoading}
      isVisible={isVisible}
    />
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
      className="fixed inset-0 flex items-center justify-center backdrop-blur-sm transition-all duration-500 ease-in-out"
      style={{
        opacity: isVisible ? 1 : 0,
      }}
    >
      <div
        className="flex flex-col justify-center w-full max-w-md rounded-lg bg-surface-primary-alt border border-border-light p-8 shadow-lg transform transition-all duration-400 ease-out"
        style={{
          opacity: isVisible ? 1 : 0,
          transform: isVisible ? 'translateY(0) scale(1)' : 'translateY(30px) scale(0.95)',
        }}
      >
        <div className="mx-auto mb-6 flex items-center justify-center">
          <div className="rounded-full bg-surface-destructive/20 p-3">
            <AlertCircle className="h-8 w-8 text-surface-destructive" />
          </div>
        </div>

        <h2 className="mb-4 text-center text-2xl font-bold text-text-primary">{TEXT.errorTitle}</h2>

        <p className="mb-8 text-center text-text-secondary">
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
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
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

        <div className="mt-6 text-center">
          <p className="text-xs text-text-tertiary">
            {TEXT.needHelp} <a href={`mailto:${TEXT.supportEmailHref}`} className="text-[#3bd5b0] hover:underline">{TEXT.supportEmail}</a>
          </p>
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
      className="fixed inset-0 flex items-center justify-center backdrop-blur-sm transition-all duration-500 ease-in-out"
      style={{
        opacity: isVisible ? 1 : 0,
      }}
    >
      <div
        className="flex flex-col justify-center w-full h-full sm:h-auto sm:max-w-3xl rounded-none sm:rounded-lg bg-surface-primary-alt border border-border-light p-8 shadow-lg transform transition-all duration-400 ease-out sm:mx-4"
        style={{
          opacity: isVisible ? 1 : 0,
          transform: isVisible ? 'translateY(0) scale(1)' : 'translateY(30px) scale(0.95)',
        }}
      >
        <div className="flex flex-col md:flex-row gap-6 max-w-5xl mx-auto w-full">
          {/* Left column - Information */}
          <div className="flex-1">
            <div className="mb-5 flex items-center space-x-2">
              <div className="rounded-full bg-[#3bd5b0]/20 p-2">
                <Sparkles className="h-6 w-6 text-[#3bd5b0]" />
              </div>
              <h2 className="text-2xl font-bold text-text-primary">{TEXT.unlockAccess}</h2>
            </div>

            <p className="text-text-secondary mb-6">
              {TEXT.subscriptionInfo}
            </p>

            <div className="space-y-5 mb-6">
              {features.map((feature, index) => (
                <div key={index} className="flex items-start">
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

            <div className="rounded-lg p-4 border border-border-light bg-surface-tertiary mb-6">
              <p className="text-sm text-text-secondary">
                {TEXT.stripeInfo}
              </p>
            </div>
          </div>

          {/* Right column - Actions */}
          <div className="md:w-72 flex flex-col">
            <div className="bg-surface-chat p-5 rounded-lg mb-4 border border-border-light">
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
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
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

            <div className="text-center">
              <p className="text-xs text-text-tertiary">
                {TEXT.needHelp} <a href={`mailto:${TEXT.supportEmailHref}`} className="text-[#3bd5b0] hover:underline">{TEXT.supportEmail}</a>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SubscriptionRequiredPage;