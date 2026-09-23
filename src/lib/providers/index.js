import { PRODUCT_IDS, parseProductSnapshot } from '../whenreset.js';

function providerFor(id) {
  return {
    id,
    enabled: true,
    kvKey: `${id}:data`,
    eventsKey: `${id}:events`,
    apiPath: `/api/${id}`,
    notifyKinds: ['confirmed', 'card'],
    notifyOnEmpty: false,
    parse(payload, opts) {
      return parseProductSnapshot(id, payload, opts);
    },
  };
}

const PROVIDERS = PRODUCT_IDS.map(providerFor);

export function getProviders() {
  return PROVIDERS;
}

export function getEnabledProviders() {
  return PROVIDERS.filter((provider) => provider.enabled);
}

export function getProviderByApiPath(pathname) {
  return PROVIDERS.find((provider) => provider.apiPath === pathname) || null;
}

export function getProviderById(id) {
  return PROVIDERS.find((provider) => provider.id === id) || null;
}
