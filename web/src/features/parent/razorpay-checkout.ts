/**
 * Parent "Pay now" flow for Razorpay Checkout.
 *
 *   const result = await payFees({ baseUrl, accessToken, invoiceIds: [q1, q2] });
 *   if (result.status === 'paid') await openReceipt({ baseUrl, accessToken, receiptId: result.receiptId })
 *
 * 1. POST /finance/create-order          -> our order + Checkout options (amount in paise)
 * 2. Razorpay Checkout collects the payment (UPI / card / net banking)
 * 3. Poll GET /finance/orders/:id         -> 'paid' once the payment.captured webhook is applied
 *
 * The browser never marks anything paid: only the signed webhook does. The Checkout
 * success callback just tells us to start polling.
 */

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

type OrderStatus = 'created' | 'paid' | 'failed' | 'expired' | 'needs_review';

interface OrderResponse {
  id: string;
  status: OrderStatus;
  amount: string;
  receiptId: string | null;
  receiptNumber: string | null;
  checkout: Record<string, unknown> & { order_id: string };
}

export type PayResult =
  | { status: 'paid'; orderId: string; receiptId: string; receiptNumber: string }
  | { status: 'processing'; orderId: string }        // paid at Razorpay, webhook not applied yet
  | { status: 'needs_review'; orderId: string }      // school office will reconcile / refund
  | { status: 'cancelled' }
  | { status: 'failed'; reason: string };

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open(): void; on(event: string, cb: (r: unknown) => void): void };
  }
}

function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = CHECKOUT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load the payment window. Check your connection.'));
    document.head.appendChild(script);
  });
}

export async function payFees(opts: {
  baseUrl: string;               // e.g. https://api.example.com/api/v1
  accessToken: string;
  invoiceIds: string[];
  amount?: string;               // part payment in rupees; omit for the full balance
  themeColor?: string;
}): Promise<PayResult> {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.accessToken}` };

  await loadCheckout();
  const res = await fetch(`${opts.baseUrl}/finance/create-order`, {
    method: 'POST',
    headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ invoiceIds: opts.invoiceIds, ...(opts.amount && { amount: opts.amount }) }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) return { status: 'failed', reason: body?.error?.message ?? 'Could not start the payment' };
  const order = body.data as OrderResponse;

  const outcome = await new Promise<'success' | 'dismissed' | { failed: string }>((resolve) => {
    const rzp = new window.Razorpay!({
      ...order.checkout,
      theme: { color: opts.themeColor ?? '#4f46e5' },
      handler: () => resolve('success'),
      modal: { ondismiss: () => resolve('dismissed'), confirm_close: true },
    });
    rzp.on('payment.failed', (r: any) => resolve({ failed: r?.error?.description ?? 'Payment failed' }));
    rzp.open();
  });

  if (outcome === 'dismissed') return { status: 'cancelled' };
  if (typeof outcome === 'object') return { status: 'failed', reason: outcome.failed };

  // Webhook usually lands within a second or two; poll for up to ~30 s.
  for (let i = 0; i < 15; i += 1) {
    await new Promise((r) => setTimeout(r, i < 5 ? 1000 : 2500));
    const poll = await fetch(`${opts.baseUrl}/finance/orders/${order.id}`, { headers });
    if (!poll.ok) continue;
    const latest = (await poll.json()).data as OrderResponse;
    if (latest.status === 'paid' && latest.receiptId) {
      return {
        status: 'paid',
        orderId: order.id,
        receiptId: latest.receiptId,
        receiptNumber: latest.receiptNumber!,
      };
    }
    if (latest.status === 'needs_review') return { status: 'needs_review', orderId: order.id };
  }
  return { status: 'processing', orderId: order.id };
}

/** The PDF endpoint needs the bearer token, so fetch it and open the blob (works in the installed PWA too). */
export async function openReceipt(opts: { baseUrl: string; accessToken: string; receiptId: string }): Promise<void> {
  const res = await fetch(`${opts.baseUrl}/finance/receipts/${opts.receiptId}/pdf`, {
    headers: { Authorization: `Bearer ${opts.accessToken}` },
  });
  if (!res.ok) throw new Error('Could not load the receipt');
  const url = URL.createObjectURL(await res.blob());
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
