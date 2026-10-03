/**
 * Local mirror of the Client Content CMS DTOs from
 * `packages/shared/src/index.ts` (`PromoBlock`, `PaymentMethod`, `PageStatus`).
 *
 * The `app/` package is a standalone Expo repository (not an npm workspace), so
 * it cannot import `@raw-radio/shared` directly — the types are mirrored here
 * and must be kept in sync with the shared source of truth. Only the fields the
 * renderer actually consumes are declared (the page metadata DTOs — PromoContentDTO
 * / ActivePromoDTO — stay with frontend-dev in `useClientContent.ts`).
 *
 * @warning MIRROR — do not edit in isolation. When the shared DTO changes, mirror
 * the change here in the same PR. Drift is silent: a renamed field becomes
 * `undefined` at runtime and a removed one is simply dropped, with no type error
 * on either side. Source of truth: `packages/shared/src/index.ts`.
 */

export type PageStatus = 'draft' | 'published'

export interface PaymentMethod {
  label: string
  cardNumber?: string
  recipient?: string
  qrImageUrl?: string
  qrValue?: string
  note?: string
}

/** Discriminated union — 11 block variants rendered by `BlockRenderer`. */
export type PromoBlock =
  | { type: 'heading'; text: string; level?: 1 | 2 | 3 }
  | { type: 'paragraph'; text: string }
  | { type: 'link'; text: string; url: string }
  | { type: 'image'; url: string; alt?: string; caption?: string }
  | { type: 'qr'; value: string; caption?: string; size?: number }
  | { type: 'button'; text: string; url: string }
  | { type: 'divider' }
  | { type: 'spacer'; size: 's' | 'm' | 'l' }
  | { type: 'progress'; collected: number; goal: number; currency?: string; label?: string }
  | { type: 'payment'; methods: PaymentMethod[] }
  | { type: 'share'; text?: string; url?: string }

/** Narrowing helper for a single block variant. */
export type BlockOf<T extends PromoBlock['type']> = Extract<PromoBlock, { type: T }>
