import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { Text } from '../../ink.js';
import { logEvent } from '../../services/analytics/index.js';
import { formatGrantAmount, getCachedOverageCreditGrant, refreshOverageCreditGrantCache } from '../../services/api/overageCreditGrant.js';
import { saveGlobalConfig } from '../../utils/config.js';
import { truncate } from '../../utils/format.js';
import type { FeedConfig } from './Feed.js';

/**
 * Explicit /usage keeps backend eligibility and grant information available.
 * Automatic welcome and tip promotions are retired independently of that
 * account information; this does not grant usage or change provider limits.
 */
export function isEligibleForOverageCreditGrant(): boolean {
  const info = getCachedOverageCreditGrant();
  if (!info || !info.available || info.granted) return false;
  return formatGrantAmount(info) !== null;
}
export function shouldShowOverageCreditUpsell(): boolean {
  return false;
}

/**
 * Kick off a background fetch if the cache is empty. Safe to call
 * unconditionally on mount — it no-ops if cache is fresh.
 */
export function maybeRefreshOverageCreditCache(): void {
  if (getCachedOverageCreditGrant() !== null) return; // cache-as-live: false positive — function name explicitly declares cached state
  void refreshOverageCreditGrantCache();
}
export function useShowOverageCreditUpsell(): boolean {
  return false;
}
export function incrementOverageCreditUpsellSeenCount(): void {
  let newCount = 0;
  saveGlobalConfig(prev => {
    newCount = (prev.overageCreditUpsellSeenCount ?? 0) + 1;
    return {
      ...prev,
      overageCreditUpsellSeenCount: newCount
    };
  });
  logEvent('tengu_overage_credit_upsell_shown', {
    seen_count: newCount
  });
}

// Copy from "OC & Bulk Overages copy" doc (#6 — CLI /usage)
function getUsageText(amount: string): string {
  return `${amount} in extra usage for third-party apps · /extra-usage`;
}

// Copy from "OC & Bulk Overages copy" doc (#4 — CLI Welcome screen).
// Char budgets: title ≤19, subtitle ≤48.
const FEED_SUBTITLE = 'On us. Works on third-party apps · /extra-usage';
function getFeedTitle(amount: string): string {
  return `${amount} in extra usage`;
}
type Props = {
  maxWidth?: number;
  twoLine?: boolean;
};
export function OverageCreditUpsell(t0) {
  const $ = _c(8);
  const {
    maxWidth,
    twoLine
  } = t0;
  let t1;
  let t2;
  if ($[0] !== maxWidth || $[1] !== twoLine) {
    t2 = Symbol.for("react.early_return_sentinel");
    bb0: {
      const info = getCachedOverageCreditGrant();
      if (!info) {
        t2 = null;
        break bb0;
      }
      const amount = formatGrantAmount(info);
      if (!amount) {
        t2 = null;
        break bb0;
      }
      if (twoLine) {
        const title = getFeedTitle(amount);
        let t3;
        if ($[4] !== maxWidth) {
          t3 = maxWidth ? truncate(FEED_SUBTITLE, maxWidth) : FEED_SUBTITLE;
          $[4] = maxWidth;
          $[5] = t3;
        } else {
          t3 = $[5];
        }
        let t4;
        if ($[6] !== t3) {
          t4 = <Text dimColor={true}>{t3}</Text>;
          $[6] = t3;
          $[7] = t4;
        } else {
          t4 = $[7];
        }
        t2 = <><Text color="claude">{maxWidth ? truncate(title, maxWidth) : title}</Text>{t4}</>;
        break bb0;
      }
      const text = getUsageText(amount);
      const display = maxWidth ? truncate(text, maxWidth) : text;
      const highlightLen = Math.min(getFeedTitle(amount).length, display.length);
      t1 = <Text dimColor={true}><Text color="claude">{display.slice(0, highlightLen)}</Text>{display.slice(highlightLen)}</Text>;
    }
    $[0] = maxWidth;
    $[1] = twoLine;
    $[2] = t1;
    $[3] = t2;
  } else {
    t1 = $[2];
    t2 = $[3];
  }
  if (t2 !== Symbol.for("react.early_return_sentinel")) {
    return t2;
  }
  return t1;
}

/**
 * Feed config for the homescreen rotating feed. Mirrors
 * createGuestPassesFeed in feedConfigs.tsx.
 *
 * Copy from "OC & Bulk Overages copy" doc (#4 — CLI Welcome screen).
 * Char budgets: title ≤19, subtitle ≤48.
 */
export function createOverageCreditFeed(): FeedConfig {
  const info = getCachedOverageCreditGrant();
  const amount = info ? formatGrantAmount(info) : null;
  const title = amount ? getFeedTitle(amount) : 'extra usage credit';
  return {
    title,
    lines: [],
    customContent: {
      content: <Text dimColor>{FEED_SUBTITLE}</Text>,
      width: Math.max(title.length, FEED_SUBTITLE.length)
    }
  };
}
