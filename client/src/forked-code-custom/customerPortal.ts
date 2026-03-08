import axios from 'axios';

type CustomerPortalResponse = {
  url?: string;
  error?: string;
};

const CUSTOMER_PORTAL_ERROR = 'Failed to create customer portal URL';

export async function getCustomerPortalUrl(): Promise<string> {
  try {
    const { data } = await axios.get<CustomerPortalResponse>('/api/forked/customer-portal');

    if (!data.url) {
      throw new Error(CUSTOMER_PORTAL_ERROR);
    }

    return data.url;
  } catch (error) {
    if (axios.isAxiosError<CustomerPortalResponse>(error)) {
      const message = error.response?.data?.error;

      if (message) {
        throw new Error(message);
      }
    }

    throw error instanceof Error ? error : new Error(CUSTOMER_PORTAL_ERROR);
  }
}
