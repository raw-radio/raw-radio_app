import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import QRCode from 'react-native-qrcode-svg'
import { CONTENT, MONO_FONT } from '../theme'
import type { BlockOf, PaymentMethod } from '../types'
import { copyToClipboard, resolveImageUrl } from '../utils'

const FEEDBACK_MS = 1800
const QR_SIZE = 160

/**
 * Payment methods card list.
 *
 * Each method renders its available fields (label / card number / recipient /
 * note) plus a QR — either a provided image or generated from `qrValue`. Copy
 * buttons use `expo-clipboard` (web included) and confirm inline for a moment.
 * Wording of the copy affordance is intentionally generic so frontend-dev can
 * swap in a toast later without touching layout.
 */
export function PaymentBlock({ block }: { block: BlockOf<'payment'> }) {
  const methods = Array.isArray(block.methods) ? block.methods : []
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const handleCopy = useCallback(async (key: string, value: string) => {
    const ok = await copyToClipboard(value)
    if (!ok) return
    setCopiedKey(key)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopiedKey(null), FEEDBACK_MS)
  }, [])

  if (methods.length === 0) return null

  return (
    <View style={styles.wrap}>
      {methods.map((method, index) => (
        <MethodCard
          key={`${method.label}-${index}`}
          method={method}
          index={index}
          copiedKey={copiedKey}
          onCopy={handleCopy}
        />
      ))}
    </View>
  )
}

interface MethodCardProps {
  method: PaymentMethod
  index: number
  copiedKey: string | null
  onCopy: (key: string, value: string) => void
}

function MethodCard({ method, index, copiedKey, onCopy }: MethodCardProps) {
  const cardKey = `${index}:card`
  const recipientKey = `${index}:recipient`

  return (
    <View style={styles.card}>
      <Text selectable style={styles.label}>
        {method.label}
      </Text>

      {!!method.cardNumber && (
        <View style={styles.fieldRow}>
          <Text style={styles.fieldValueCard} selectable numberOfLines={1}>
            {method.cardNumber}
          </Text>
          <CopyButton
            copied={copiedKey === cardKey}
            onPress={() => onCopy(cardKey, method.cardNumber as string)}
          />
        </View>
      )}

      {!!method.recipient && (
        <View style={styles.fieldRow}>
          <Text style={styles.fieldValue} selectable numberOfLines={2}>
            {method.recipient}
          </Text>
          <CopyButton
            copied={copiedKey === recipientKey}
            onPress={() => onCopy(recipientKey, method.recipient as string)}
          />
        </View>
      )}

      {(!!method.qrImageUrl || !!method.qrValue) && (
        <View style={styles.qrTile}>
          {method.qrImageUrl ? (
            <Image
              source={{ uri: resolveImageUrl(method.qrImageUrl) }}
              style={styles.qrImage}
              resizeMode="contain"
              accessible
              accessibilityLabel={`QR — ${method.label}`}
            />
          ) : (
            <QRCode
              value={method.qrValue as string}
              size={QR_SIZE}
              backgroundColor="#fff"
              color={CONTENT.qrOnWhite}
            />
          )}
        </View>
      )}

      {!!method.note && (
        <Text selectable style={styles.note}>
          {method.note}
        </Text>
      )}
    </View>
  )
}

function CopyButton({ copied, onPress }: { copied: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={copied ? 'Скопировано' : 'Копировать'}
      style={({ pressed }) => [styles.copyBtn, pressed && styles.copyBtnPressed]}
    >
      <Ionicons
        name={copied ? 'checkmark' : 'copy-outline'}
        size={16}
        color={copied ? CONTENT.accent : CONTENT.text}
      />
      <Text style={[styles.copyLabel, copied && styles.copyLabelDone]}>
        {copied ? 'Готово' : 'Копировать'}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 16,
  },
  card: {
    backgroundColor: CONTENT.panel,
    borderWidth: 1,
    borderColor: CONTENT.border,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  label: {
    color: CONTENT.heading,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 10,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  fieldValueCard: {
    flex: 1,
    color: CONTENT.heading,
    fontFamily: MONO_FONT,
    fontSize: 16,
    letterSpacing: 0.5,
  },
  fieldValue: {
    flex: 1,
    color: CONTENT.text,
    fontSize: 15,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: CONTENT.accentSoft,
  },
  copyBtnPressed: {
    opacity: 0.7,
  },
  copyLabel: {
    color: CONTENT.text,
    fontSize: 12,
    fontWeight: '600',
  },
  copyLabelDone: {
    color: CONTENT.accent,
  },
  qrTile: {
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 4,
    padding: 10,
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  qrImage: {
    width: QR_SIZE,
    height: QR_SIZE,
  },
  note: {
    color: CONTENT.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 8,
  },
})
