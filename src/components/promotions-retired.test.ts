import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = (path: string) => readFileSync(`${root}${path}`, 'utf8')

// Run mocked UI imports in a child so the rest of the suite never inherits mocks.
// No React installation, provider access, configuration writes, or network needed.
const probe = Bun.spawnSync({
  cmd: [process.execPath, '-e', `
    import { mock } from 'bun:test';
    const calls = { fetch: 0, write: 0, telemetry: 0, config: 0 };
    let grant = { available: true, granted: false, amount: '$20' };
    const element = (type, props) => ({ type, props });
    mock.module('react', () => ({ useState: value => [typeof value === 'function' ? value() : value, () => {}], useEffect: () => {} }));
    mock.module('react/compiler-runtime', () => ({ c: n => Array(n).fill(Symbol.for('react.memo_cache_sentinel')) }));
    for (const module of ['react/jsx-runtime', 'react/jsx-dev-runtime']) {
      mock.module(module, () => ({ jsx: element, jsxs: element, jsxDEV: element, Fragment: 'Fragment' }));
    }
    const local = (path, exports) => mock.module(process.cwd() + '/src/' + path, () => exports);
    local('ink.js', { Text: 'Text', Box: 'Box' });
    local('services/analytics/index.js', { logEvent: () => calls.telemetry++ });
    local('services/analytics/growthbook.js', {
      getDynamicConfig_CACHED_MAY_BE_STALE: () => ({ enable_shortcut_tip: true, enable_startup_dialog: true })
    });
    local('services/api/referral.js', {
      checkCachedPassesEligibility: () => ({ eligible: true, hasCache: true }),
      getCachedRemainingPasses: () => 3,
      getCachedReferrerReward: () => 2000,
      formatCreditAmount: () => '$20'
    });
    local('services/api/overageCreditGrant.js', {
      getCachedOverageCreditGrant: () => grant,
      formatGrantAmount: value => value.amount,
      refreshOverageCreditGrantCache: () => { calls.fetch++; return Promise.resolve(); }
    });
    local('utils/config.js', {
      getGlobalConfig: () => { calls.config++; return {}; },
      saveGlobalConfig: () => calls.write++
    });
    local('utils/format.js', { truncate: (text, length) => text.slice(0, length) });
    local('components/CustomSelect/select.js', { Select: 'Select' });
    local('components/DesktopHandoff.js', { DesktopHandoff: 'DesktopHandoff' });
    local('components/permissions/PermissionDialog.js', { PermissionDialog: 'PermissionDialog' });
    const guest = await import('./src/components/LogoV2/GuestPassesUpsell.tsx');
    const overage = await import('./src/components/LogoV2/OverageCreditUpsell.tsx');
    const desktop = await import('./src/components/DesktopUpsell/DesktopUpsellStartup.tsx');
    guest.incrementGuestPassesSeenCount();
    const welcome = [guest.useShowGuestPassesUpsell(), guest.GuestPassesUpsell(), overage.shouldShowOverageCreditUpsell(), overage.useShowOverageCreditUpsell()];
    const usage = { eligible: overage.isEligibleForOverageCreditGrant(), rendered: overage.OverageCreditUpsell({}) };
    grant = { available: true, granted: true, amount: '$20' };
    usage.alreadyGranted = overage.isEligibleForOverageCreditGrant();
    grant = { available: false, granted: false, amount: '$20' };
    usage.unavailable = overage.isEligibleForOverageCreditGrant();
    grant = null;
    usage.missing = overage.isEligibleForOverageCreditGrant();
    welcome.push(overage.useShowOverageCreditUpsell());
    const flags = desktop.getDesktopUpsellConfig();
    flags.enable_startup_dialog = true;
    const promotion = { flags: desktop.getDesktopUpsellConfig(), show: desktop.shouldShowDesktopUpsellStartup() };
    console.log(JSON.stringify({ welcome, usage, promotion, calls }));
  `],
  cwd: root,
  stdout: 'pipe',
  stderr: 'pipe',
})
if (probe.exitCode !== 0) throw new Error(probe.stderr.toString())
const result = JSON.parse(probe.stdout.toString())

describe('retired optional promotions', () => {
  test('eligible referrals and credits do not prompt, fetch, or change records on welcome', () => {
    expect(result.welcome).toEqual([false, null, false, false, false])
    expect(result.calls).toEqual({ fetch: 0, write: 0, telemetry: 0, config: 0 })
  })

  test('explicit usage keeps factual grant display and backend eligibility', () => {
    expect(result.usage.eligible).toBe(true)
    expect(result.usage.alreadyGranted).toBe(false)
    expect(result.usage.unavailable).toBe(false)
    expect(result.usage.missing).toBe(false)
    expect(JSON.stringify(result.usage.rendered)).toContain('$20 in extra usage')
    expect(JSON.stringify(result.usage.rendered)).toContain('/extra-usage')
  })

  test('remote promotion flags and returned-object mutations cannot enable app ads', () => {
    expect(result.promotion).toEqual({
      flags: { enable_shortcut_tip: false, enable_startup_dialog: false },
      show: false,
    })
  })

  test('entry registries omit referrals and app ads while keeping direct tools', () => {
    const commands = read('src/commands.ts')
    expect(commands).not.toMatch(/import passes |^\s*passes,/m)
    for (const command of ['usage', 'extraUsage', 'desktop']) {
      expect(commands).toMatch(new RegExp('^\\s*' + command + ',', 'm'))
    }
    const tips = read('src/services/tips/tipRegistry.ts')
    for (const id of ['guest-passes', 'overage-credit', 'desktop-app', 'desktop-shortcut', 'web-app', 'mobile-app']) {
      expect(tips).not.toContain(`id: '${id}'`)
    }
    expect(tips).toContain("id: 'ide-upsell-external-terminal'")
    expect(read('src/components/Settings/Usage.tsx')).toContain('isEligibleForOverageCreditGrant()')
  })

  test('edited entry and UI sources transpile', () => {
    const transpiler = new Bun.Transpiler({ loader: 'tsx' })
    for (const path of [
      'src/commands.ts',
      'src/components/LogoV2/GuestPassesUpsell.tsx',
      'src/components/LogoV2/OverageCreditUpsell.tsx',
      'src/components/DesktopUpsell/DesktopUpsellStartup.tsx',
      'src/services/tips/tipRegistry.ts',
    ]) expect(() => transpiler.transformSync(read(path))).not.toThrow()
  })
})
