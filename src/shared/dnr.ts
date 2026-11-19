/**
 * DeclarativeNetRequest rules for engines whose upstream rejects
 * browser-extension `Origin` headers.
 *
 * Some CDNs (the one in front of Bilibili's Index-Translate API) answer
 * requests carrying `Origin: chrome-extension://<id>` with HTTP 412 and
 * an HTML bot-challenge page. The service's own documentation tells
 * browser extensions to route calls through a local proxy — and such a
 * proxy sends the request with no `Origin` header at all.
 *
 * Rather than shipping a proxy, we strip the header from our own
 * requests with a DNR rule, so the request we put on the wire has the
 * same shape as the documented proxy flow. We are not impersonating
 * another origin: the header is simply omitted.
 *
 * The rule is scoped twice over — to requests we initiate ourselves
 * (`initiatorDomains`) and to the specific hosts that need it
 * (`urlFilter`) — so no other traffic is affected.
 */

import { getProvider, PROVIDERS } from './providers';
import { ProviderId } from './types';

/** Rule ids are stable so we can replace them on every startup. */
const RULE_ID_BASE = 9100;

export interface DnrRule {
  id: number;
  priority: number;
  action: {
    type: 'modifyHeaders';
    requestHeaders: Array<{ header: string; operation: 'remove' }>;
  };
  condition: {
    urlFilter: string;
    initiatorDomains: string[];
    requestMethods: string[];
    resourceTypes: string[];
  };
}

/** Host of every provider that needs the Origin header stripped. */
function hostsNeedingOriginStrip(): string[] {
  const hosts: string[] = [];
  for (const spec of Object.values(PROVIDERS)) {
    if (!spec.stripOriginHeader) continue;
    try {
      const url = new URL(spec.endpoint);
      hosts.push(url.hostname);
    } catch {
      // A provider without a parseable endpoint can't need a rule.
    }
  }
  return hosts;
}

/**
 * Build the DNR rules for the given extension id. Kept pure so it can be
 * unit-tested without the extension APIs.
 */
export function buildOriginStripRules(extensionId: string): DnrRule[] {
  const hosts = hostsNeedingOriginStrip();
  if (hosts.length === 0) return [];

  // DNR's urlFilter is a Chrome extension filter syntax; "||host" matches
  // the host and all of its subdomains.
  const urlFilter = hosts.map(h => `||${h}`).join('|');

  return [
    {
      id: RULE_ID_BASE,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [{ header: 'Origin', operation: 'remove' }],
      },
      condition: {
        urlFilter,
        initiatorDomains: [extensionId],
        requestMethods: ['post'],
        resourceTypes: ['xmlhttprequest'],
      },
    },
  ];
}

/**
 * Install (or refresh) the rules. Safe to call repeatedly — the rules
 * are replaced by id. Returns true when the rules were installed.
 */
export async function installOriginStripRules(extensionId: string): Promise<boolean> {
  const dnr = (globalThis as any).chrome?.declarativeNetRequest;
  if (!dnr?.updateDynamicRules) return false;

  const rules = buildOriginStripRules(extensionId);
  const removeRuleIds = rules.map(rule => rule.id);
  // Also clear a stale rule set from a previous version.
  removeRuleIds.push(RULE_ID_BASE + 1);

  try {
    await dnr.updateDynamicRules({ removeRuleIds, addRules: rules });
    return true;
  } catch (error) {
    console.warn('[EasyTranslate] failed to install DNR rules:', error);
    return false;
  }
}

/** The provider id whose API needs the workaround, if any. */
export function providerNeedingOriginStrip(id: ProviderId): boolean {
  return getProvider(id).stripOriginHeader === true;
}
