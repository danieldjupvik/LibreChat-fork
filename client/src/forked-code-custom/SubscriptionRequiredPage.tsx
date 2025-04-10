import React from 'react';

// Define the props type for the component
type SubscriptionRequiredPageProps = {
  onLogout: () => void;
  error?: boolean;
};

/**
 * Page shown to users who are authenticated but lack an active subscription
 * or encountered an error during the subscription check.
 */
const SubscriptionRequiredPage = ({ onLogout, error = false }: SubscriptionRequiredPageProps) => {
  const title = error ? 'Error Checking Access' : 'Subscription Required';
  const message = error
    ? 'We encountered an error while checking your access status. Please try again later or contact support.'
    : 'You need an active subscription to access this application. Please contact support or visit our subscription page to continue.';
  const buttonText = 'Get Subscription';
  const logoutText = 'Logout';

  return (
    <div className="flex h-screen w-screen items-center justify-center text-text-secondary">
      <div className="max-w-md rounded-lg bg-white p-8 shadow-md ">
        <h2 className="mb-4 text-2xl font-bold ">{title}</h2>
        <p className="mb-6 ">
          {message}
        </p>
        {!error && (
          <a
            href="https://lago.danieldjupvik.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            tabIndex={0}
            aria-label="Visit subscription page"
          >
            {buttonText}
          </a>
        )}
        <div
          onClick={onLogout}
          className={
            'inline-flex items-center rounded-md bg-gray-200 px-4 py-2 text-gray-800 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 cursor-pointer' +
            (error ? '' : ' ml-4')
          }
          tabIndex={0}
          aria-label="Logout"
          role="button"
        >
          {logoutText}
        </div>
      </div>
    </div>
  );
};

export default SubscriptionRequiredPage;