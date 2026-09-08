import { claudeProvider } from './claude.js';
import { codexProvider } from './codex.js';

const PROVIDERS = [codexProvider, claudeProvider];

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
