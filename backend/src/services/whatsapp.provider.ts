import { env } from '../config/env.js';

/**
 * WhatsApp delivery adapter used by the notification dispatcher.
 *
 *  - gateway: POST WHATSAPP_API_URL with `Authorization: Bearer <token>` and JSON
 *      { to, message, title, body, reference }. Most Indian WhatsApp gateways (NeverSkip,
 *      Interakt, Gupshup proxies) accept this or need only a field rename here.
 *  - meta: WhatsApp Cloud API. Uses WHATSAPP_TEMPLATE_NAME when set (required for
 *      messages outside a 24-hour customer window), plain text otherwise.
 */
export interface WhatsAppMessage { to: string; title: string; body: string | null; reference: string }

/** Digits only, with the default country code added to 10-digit local numbers. Null when unusable. */
export function whatsappNumber(raw: string | null | undefined, countryCode = env.WHATSAPP_DEFAULT_COUNTRY_CODE): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = `${countryCode}${d}`;
  return d.length >= 11 && d.length <= 15 ? d : null;
}

export function whatsappText(m: Pick<WhatsAppMessage, 'title' | 'body'>) {
  return m.body ? `*${m.title}*\n${m.body}` : m.title;
}

/** Sends one message; returns the provider's message id. Throws on any failure (the dispatcher retries). */
export async function sendWhatsApp(m: WhatsAppMessage, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  if (!env.WHATSAPP_API_URL || !env.WHATSAPP_API_TOKEN) throw new Error('WhatsApp is not configured');
  const payload = env.WHATSAPP_PROVIDER === 'meta'
    ? env.WHATSAPP_TEMPLATE_NAME
      ? {
          messaging_product: 'whatsapp', to: m.to, type: 'template',
          template: {
            name: env.WHATSAPP_TEMPLATE_NAME, language: { code: env.WHATSAPP_TEMPLATE_LANG },
            components: [{ type: 'body', parameters: [{ type: 'text', text: m.title }, { type: 'text', text: m.body ?? '-' }] }],
          },
        }
      : { messaging_product: 'whatsapp', to: m.to, type: 'text', text: { body: whatsappText(m) } }
    : { to: m.to, message: whatsappText(m), title: m.title, body: m.body, reference: m.reference };

  const res = await fetchImpl(env.WHATSAPP_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.WHATSAPP_API_TOKEN}` },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`WhatsApp provider replied ${res.status}: ${text.slice(0, 200)}`);
  try {
    const j = JSON.parse(text);
    return j?.messages?.[0]?.id ?? j?.id ?? j?.messageId ?? j?.message_id ?? j?.data?.id ?? null;
  } catch {
    return null;
  }
}
