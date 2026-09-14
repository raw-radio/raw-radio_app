import { useState, useEffect, useCallback } from 'react'
import { storage, STORAGE_KEYS } from './useStorage'

export interface SubstationInfo {
  id: string
  name: string
  icon: string
  slug: string
  color: string
  isActive: boolean
}

export function useSubstations() {
  const [substations, setSubstations] = useState<SubstationInfo[]>([])
  const [currentSlug, setCurrentSlug] = useState<string>('main')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    storage.getItem(STORAGE_KEYS.SUBSTATION).then((saved) => {
      if (saved) setCurrentSlug(saved)
    })

    fetch(`${process.env.EXPO_PUBLIC_API_URL || ''}/api/v1/substations`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          const active = data.data.filter((s: SubstationInfo) => s.isActive)
          setSubstations(active)
          storage.getItem(STORAGE_KEYS.SUBSTATION).then((saved) => {
            if (!active.find((s: SubstationInfo) => s.slug === saved) && active.length > 0) {
              const first = active[0].slug
              setCurrentSlug(first)
              storage.setItem(STORAGE_KEYS.SUBSTATION, first)
            }
          })
        }
      })
      .catch(() => {
        setSubstations([
          {
            id: 'main',
            name: 'Main',
            icon: 'radio',
            slug: 'main',
            color: '#2ECC71',
            isActive: true,
          },
        ])
      })
      .finally(() => setLoading(false))
  }, [])

  const selectSubstation = useCallback((slug: string) => {
    setCurrentSlug(slug)
    storage.setItem(STORAGE_KEYS.SUBSTATION, slug)
  }, [])

  const currentSubstation = substations.find((s) => s.slug === currentSlug) || substations[0]

  return { substations, currentSlug, currentSubstation, selectSubstation, loading }
}
