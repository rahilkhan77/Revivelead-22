export type BillingResult<T = unknown> = {
  ok: boolean;
  error?: string;
  data?: T;
};

export function billingOk<T>(data?: T): BillingResult<T> {
  return { ok: true, data };
}

export function billingFail(error: string): BillingResult<never> {
  return { ok: false, error };
}
