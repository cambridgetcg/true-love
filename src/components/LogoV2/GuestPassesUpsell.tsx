// Referral promotions are retired. Keep the welcome-screen interface so both
// logo layouts can remain quiet without reading or changing referral records.
export function useShowGuestPassesUpsell(): boolean {
  return false;
}

export function incrementGuestPassesSeenCount(): void {}

export function GuestPassesUpsell() {
  return null;
}
