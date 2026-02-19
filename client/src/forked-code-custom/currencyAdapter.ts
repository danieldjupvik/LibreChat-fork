let usdToNokRateCache: number | null = null;
let lastFetchTime = 0;
let lastFetchFailed = false;
let usdToNokRatePromise: Promise<number | null> | null = null;

const CACHE_DURATION_MS = 60 * 60 * 1000;
const FAILURE_BACKOFF_MS = 60_000;
const USD_TO_NOK_ENDPOINT = 'https://api.frankfurter.app/latest?from=USD&to=NOK';

export const fetchUsdToNokRate = async (): Promise<number | null> => {
  const now = Date.now();
  const cooldown = lastFetchFailed ? FAILURE_BACKOFF_MS : CACHE_DURATION_MS;

  if (now - lastFetchTime < cooldown) {
    return usdToNokRateCache;
  }

  if (usdToNokRatePromise) {
    return usdToNokRatePromise;
  }

  usdToNokRatePromise = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(USD_TO_NOK_ENDPOINT, { signal: controller.signal });
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
      lastFetchFailed = false;

      return rate;
    } catch (error) {
      console.error('Error fetching USD/NOK rate:', error);
      lastFetchTime = Date.now();
      lastFetchFailed = true;
      return usdToNokRateCache;
    } finally {
      clearTimeout(timer);
      usdToNokRatePromise = null;
    }
  })();

  return usdToNokRatePromise;
};
