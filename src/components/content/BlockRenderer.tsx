import React from 'react'
import { ButtonBlock } from './blocks/ButtonBlock'
import { DividerBlock } from './blocks/DividerBlock'
import { HeadingBlock } from './blocks/HeadingBlock'
import { ImageBlock } from './blocks/ImageBlock'
import { LinkBlock } from './blocks/LinkBlock'
import { ParagraphBlock } from './blocks/ParagraphBlock'
import { PaymentBlock } from './blocks/PaymentBlock'
import { ProgressBlock } from './blocks/ProgressBlock'
import { QrBlock } from './blocks/QrBlock'
import { ShareBlock } from './blocks/ShareBlock'
import { SpacerBlock } from './blocks/SpacerBlock'
import type { PromoBlock } from './types'

/**
 * Renders an ordered list of CMS blocks. Unknown `block.type` values (forward
 * compatibility with newer CMS payloads) are ignored rather than throwing.
 */
export function BlockRenderer({ blocks }: { blocks: PromoBlock[] }) {
  if (!Array.isArray(blocks) || blocks.length === 0) return null

  return (
    <>
      {blocks.map((block, index) => (
        <BlockItem key={index} block={block} />
      ))}
    </>
  )
}

function BlockItem({ block }: { block: PromoBlock }) {
  switch (block.type) {
    case 'heading':
      return <HeadingBlock block={block} />
    case 'paragraph':
      return <ParagraphBlock block={block} />
    case 'link':
      return <LinkBlock block={block} />
    case 'image':
      return <ImageBlock block={block} />
    case 'qr':
      return <QrBlock block={block} />
    case 'button':
      return <ButtonBlock block={block} />
    case 'divider':
      return <DividerBlock />
    case 'spacer':
      return <SpacerBlock block={block} />
    case 'progress':
      return <ProgressBlock block={block} />
    case 'payment':
      return <PaymentBlock block={block} />
    case 'share':
      return <ShareBlock block={block} />
    default: {
      // Exhaustive over `PromoBlock`; at runtime an unknown type lands here.
      const _exhaustive: never = block
      void _exhaustive
      return null
    }
  }
}
