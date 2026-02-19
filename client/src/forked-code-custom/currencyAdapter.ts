let usdToNokRateCache: number | null = null;
let lastFetchTime = 0;
let usdToNokRatePromise: Promise<number | null> | null = null;

const CACHE_DURATION_MS = 60 * 60 * 1000;
const USD_TO_NOK_ENDPOINT = 'https://api.frankfurter.app/latest?from=USD&to=NOK';

export const fetchUsdToNokRate = async (): Promise<number | null> => {
  const now = Date.now();

  if (now - lastFetchTime < CACHE_DURATION_MS) {
    return usdToNokRateCache;
  }

  if (usdToNokRatePromise) {
    return usdToNokRatePromise;
  }

  usdToNokRatePromise = (async () => {
    try {
      const response = await fetch(USD_TO_NOK_ENDPOINT);
      if (!response.ok) {
        throw new Error(`Failed to fetch USD/NOK rate: ${response.status}`);
      }

      const data = (await response.json()) as {
        rates?: {
          NOK?: number;
        };
      };

      const rate = Number(data?.rates?.NOK);
      if (!Number.isFinite(rate) || rate <= 0) {
        throw new Error('Invalid USD/NOK rate');
      }

      usdToNokRateCache = rate;
      lastFetchTime = Date.now();

      return rate;
    } catch (error) {
      console.error('Error fetching USD/NOK rate:', error);
      lastFetchTime = Date.now();
      return usdToNokRateCache;
    } finally {
      usdToNokRatePromise = null;
    }
  })();

  return usdToNokRatePromise;
};
