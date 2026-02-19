import React, { useEffect, useState } from 'react';
import {
  Loader2,
  CreditCard,
  ShieldCheck,
  AlertCircle,
  LockKeyhole,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import type { DenialReason } from './RouteGuard';

const DENIAL_CONTENT: Record<string, { title: string; description: string; statusInfo: string }> = {
  no_account: {
    title: 'Account Not Found',
    description:
      'We could not find a billing account associated with your email. Please make sure you have signed up for our service and try again.',
    statusInfo:
      'No billing account was found for your email. If you recently signed up, try verifying your access status.',
  },
  no_payment_method: {
    title: 'Payment Method Required',
    description:
      'Your account exists but no payment method is connected. Please add a payment method through the billing portal to activate your access.',
    statusInfo:
      'Your account is missing a payment method. Add one through the billing portal, then verify your access.',
  },
  no_active_subscription: {
    title: 'Subscription Inactive',
    description:
      "Your payment method is set up, but you don't have an active subscription. Please activate a subscription to get access.",
    statusInfo:
      'Your subscription is currently inactive. Activate a subscription, then verify your access status.',
  },
  default: {
    title: 'Unlock Full Access',
    description:
      'To get access to this premium service, you need to activate your subscription. Our pay-as-you-go model ensures you only pay for what you use.',
    statusInfo:
      'Your subscription is currently inactive. You can check again to verify your access status.',
  },
};

const TEXT = {
  errorTitle: 'Connection Issue',
  errorMessage:
    'We encountered a problem verifying your subscription status. Please try again or contact support if the issue persists.',
  tryAgain: 'Try Again',
  logout: 'Logout',
  stripeInfo:
    'Our payment system is powered by Stripe, ensuring your payment information is secure and protected.',
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

const MIN_LOADING_TIME = 1000;

type SubscriptionRequiredPageProps = {
  onLogout: () => void;
  error?: boolean;
  onRecheck: () => void;
  isLoading?: boolean;
  denialReason?: DenialReason;
  checkoutUrl?: string | null;
};

const SubscriptionRequiredPage = ({
  onLogout,
  error = false,
  onRecheck,
  isLoading = false,
  denialReason = null,
  checkoutUrl = null,
}: SubscriptionRequiredPageProps) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isLocalLoading, setIsLocalLoading] = useState(false);

  useEffect(() => {
    setIsVisible(false);
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  const handleRecheck = () => {
    setIsLocalLoading(true);
    onRecheck();
    setTimeout(() => {
      setIsLocalLoading(false);
    }, MIN_LOADING_TIME);
  };

  const combinedLoading = isLoading || isLocalLoading;

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
      denialReason={denialReason}
      checkoutUrl={checkoutUrl}
    />
  );

  return <div className="flex h-full items-center justify-center self-center">{content}</div>;
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
      className={`flex h-full w-full transform flex-col justify-center rounded-none border border-border-light bg-surface-primary-alt bg-gradient-to-br from-[#3bd5b0]/5 via-transparent to-[#3bd5b0]/10 p-6 shadow-lg transition-all duration-700 ease-out sm:mx-4 sm:h-auto sm:max-w-lg sm:rounded-lg md:p-10 ${
        isVisible ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-8 scale-95 opacity-0'
      }`}
      style={{ willChange: 'opacity, transform' }}
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col">
        <div className="mx-auto mb-6 flex items-center justify-center md:mb-8">
          <div className="bg-surface-destructive/20 rounded-full p-3">
            <AlertCircle size={32} className="text-surface-destructive" />
          </div>
        </div>

        <h2 className="mb-4 text-center text-2xl font-bold text-text-primary md:mb-6">
          {TEXT.errorTitle}
        </h2>

        <p className="mb-8 text-center text-text-secondary md:mb-10">{TEXT.errorMessage}</p>

        <div className="space-y-3 sm:flex sm:justify-center sm:gap-4 sm:space-y-0">
          <button
            type="button"
            onClick={onRecheck}
            disabled={isLoading}
            className="inline-flex w-full items-center justify-center rounded-md bg-[#3bd5b0] px-4 py-2 text-surface-primary-alt transition-all duration-200 hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-[#3bd5b0]/50 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
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
            className="inline-flex w-full items-center justify-center rounded-md border border-border-light bg-surface-secondary px-4 py-2 text-secondary-foreground/90 transition-all duration-200 hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 sm:w-auto"
            tabIndex={0}
            aria-label="Logout"
            onKeyDown={(e) => e.key === 'Enter' && onLogout()}
          >
            {TEXT.logout}
          </button>
        </div>

        <div className="mt-6 md:mt-8">
          <div className="rounded-lg border border-border-light bg-surface-tertiary p-4 md:p-6">
            <div className="flex items-center gap-3">
              <ShieldCheck size={25} className="flex-shrink-0 text-[#3bd5b0]" />
              <p className="text-sm text-text-secondary">{TEXT.stripeInfo}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const ActionButtons = ({
  onRecheck,
  onLogout,
  isLoading,
  statusInfo,
  checkoutUrl,
}: {
  onRecheck: () => void;
  onLogout: () => void;
  isLoading: boolean;
  statusInfo: string;
  checkoutUrl?: string | null;
}) => (
  <>
    <h3 className="mb-2 font-medium text-text-primary">{'Access Status'}</h3>
    <p className="mb-6 text-sm text-text-secondary">{statusInfo}</p>

    {checkoutUrl && (
      <a
        href={checkoutUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mb-3 inline-flex w-full items-center justify-center rounded-md bg-[#3bd5b0] px-4 py-2 text-surface-primary-alt transition-all duration-200 hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-[#3bd5b0]/50 focus:ring-offset-2"
        aria-label="Add payment method"
      >
        <CreditCard className="mr-3 h-4 w-4" />
        {'Add Payment Method'}
      </a>
    )}

    <button
      type="button"
      onClick={onRecheck}
      disabled={isLoading}
      className={`inline-flex w-full items-center justify-center rounded-md px-4 py-2 transition-all duration-200 hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
        checkoutUrl
          ? 'mb-3 border border-border-light bg-surface-secondary text-secondary-foreground/90 focus:ring-gray-400'
          : 'mb-3 bg-[#3bd5b0] text-surface-primary-alt focus:ring-[#3bd5b0]/50'
      }`}
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
      className="inline-flex w-full items-center justify-center rounded-md border border-border-light bg-surface-secondary px-4 py-2 text-secondary-foreground/90 transition-all duration-200 hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2"
      tabIndex={0}
      aria-label="Logout"
      onKeyDown={(e) => e.key === 'Enter' && onLogout()}
    >
      {TEXT.logout}
    </button>
  </>
);

const SubscriptionView = ({
  onLogout,
  onRecheck,
  isLoading,
  isVisible,
  denialReason,
  checkoutUrl,
}: {
  onLogout: () => void;
  onRecheck: () => void;
  isLoading: boolean;
  isVisible: boolean;
  denialReason: DenialReason;
  checkoutUrl?: string | null;
}) => {
  const reasonKey = denialReason ?? 'default';
  const denialContent = DENIAL_CONTENT[reasonKey] || DENIAL_CONTENT.default;

  const features = [
    {
      title: TEXT.features.payAsYouGo.title,
      description: TEXT.features.payAsYouGo.desc,
      icon: <CreditCard className="h-5 w-5 text-[#3bd5b0]" />,
    },
    {
      title: TEXT.features.processingFee.title,
      description: TEXT.features.processingFee.desc,
      icon: <ShieldCheck className="h-5 w-5 text-[#3bd5b0]" />,
    },
    {
      title: TEXT.features.premiumSupport.title,
      description: TEXT.features.premiumSupport.desc,
      icon: <LockKeyhole className="h-5 w-5 text-[#3bd5b0]" />,
    },
  ];

  return (
    <div
      id="subscription-card"
      className={`flex h-full w-full transform flex-col justify-center rounded-none border border-border-light bg-surface-primary-alt bg-gradient-to-br from-[#3bd5b0]/5 via-transparent to-[#3bd5b0]/10 p-6 shadow-lg transition-all duration-700 ease-out sm:mx-4 sm:h-auto sm:max-w-3xl sm:rounded-lg md:max-w-4xl md:p-10 ${
        isVisible ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-8 scale-95 opacity-0'
      }`}
      style={{ willChange: 'opacity, transform' }}
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col md:flex-row">
        {/* Left column - Information */}
        <div className="flex flex-1 flex-col md:pr-10">
          <div className="mb-6 flex items-center space-x-2 md:mb-8">
            <div className="rounded-full bg-[#3bd5b0]/20 p-2">
              <Sparkles className="h-6 w-6 text-[#3bd5b0]" />
            </div>
            <h2 className="text-2xl font-bold text-text-primary" style={{ marginLeft: '0.75rem' }}>
              {denialContent.title}
            </h2>
          </div>

          <p className="mb-8 text-text-secondary md:mb-10">{denialContent.description}</p>

          <div className="mb-8 space-y-6 md:mb-10 md:space-y-8">
            {features.map((feature, index) => (
              <div
                key={index}
                className={`flex transform items-start transition-all duration-700 ease-out ${
                  isVisible ? 'translate-x-0 opacity-100' : 'translate-x-8 opacity-0'
                }`}
                style={{
                  transitionDelay: `${300 + index * 150}ms`,
                  willChange: 'opacity, transform',
                }}
              >
                <div className="mr-3 mt-1 flex-shrink-0">{feature.icon}</div>
                <div>
                  <h3 className="font-medium text-text-primary">{feature.title}</h3>
                  <p className="text-sm text-text-secondary">{feature.description}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Mobile Actions */}
          <div className="mb-6 flex flex-col md:hidden">
            <div
              className={`mb-4 transform rounded-lg border border-border-light bg-surface-chat p-5 transition-all duration-700 ease-out ${
                isVisible
                  ? 'translate-y-0 scale-100 opacity-100'
                  : 'translate-y-8 scale-95 opacity-0'
              }`}
              style={{
                transitionDelay: '500ms',
                willChange: 'opacity, transform',
              }}
            >
              <ActionButtons
                onRecheck={onRecheck}
                onLogout={onLogout}
                isLoading={isLoading}
                statusInfo={denialContent.statusInfo}
                checkoutUrl={checkoutUrl}
              />
            </div>
          </div>

          <div
            className={`transform rounded-lg border border-border-light bg-surface-tertiary p-4 transition-all duration-700 ease-out md:mb-0 md:p-6 ${
              isVisible ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'
            }`}
            style={{
              transitionDelay: '600ms',
              willChange: 'opacity, transform',
            }}
          >
            <div className="flex items-center gap-3">
              <ShieldCheck size={25} className="flex-shrink-0 text-[#3bd5b0]" />
              <p className="text-sm text-text-secondary">{TEXT.stripeInfo}</p>
            </div>
          </div>
        </div>

        {/* Desktop Actions Column */}
        <div className="hidden flex-col border-border-light md:flex md:w-80 md:border-l md:pl-10">
          <div
            className={`mb-4 transform rounded-lg border border-border-light bg-surface-chat p-5 transition-all duration-700 ease-out ${
              isVisible ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-8 scale-95 opacity-0'
            }`}
            style={{
              transitionDelay: '500ms',
              willChange: 'opacity, transform',
            }}
          >
            <ActionButtons
              onRecheck={onRecheck}
              onLogout={onLogout}
              isLoading={isLoading}
              statusInfo={denialContent.statusInfo}
              checkoutUrl={checkoutUrl}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default SubscriptionRequiredPage;
